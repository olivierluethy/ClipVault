//! Duplicate / near-duplicate detection for the "Similar" view.
//!
//! Exact duplicates never reach the history: `insert_or_bump` collapses them by
//! `content_hash`. What survives is everything that *hashes* differently but is the same
//! thing to a human — a trailing newline, a different case, the same URL carrying a
//! tracking query, a snippet re-copied after a one-word edit, or a screenshot re-encoded
//! at another size.
//!
//! Detection runs in three passes over the most recent [`SCAN_LIMIT`] live items:
//!
//! 1. **Normalize**, then group by the normalized text. Anything landing in the same
//!    bucket is *identical* (similarity 1.0).
//! 2. **Near-duplicates** between the distinct normalized forms, using the shared
//!    Levenshtein [`ratio`](super::levenshtein::ratio). Pairwise comparison of a whole
//!    history does not scale, so candidates go through a sorted-neighbourhood window plus
//!    two cheap gates (length ratio, then character-multiset overlap) before any DP runs.
//! 3. **Images** by perceptual hash (dHash), so a re-encode or a resize still matches.
//!    Hashes are computed once and cached in `items.phash`.
//!
//! Groups are merged with a union-find, so a chain of pairwise matches becomes one
//! cluster. Only entries of the same `type` are ever compared — a link is never clustered
//! with a text note.

use std::collections::HashMap;

use rusqlite::params;

use super::items::{map_item, ItemDto, ITEM_COLS};
use super::levenshtein::ratio;
use super::Storage;

/// Setting key holding the similarity threshold, as a string in `0.5..=1.0`.
pub const THRESHOLD_KEY: &str = "similarity_threshold";
/// Threshold used when the setting is unset or unparseable: entries must be 90% alike.
pub const DEFAULT_THRESHOLD: f64 = 0.90;

/// Newest N live items considered. Matches the cap `fuzzy_search` uses, so the two
/// expensive scans behave the same way on a huge history.
const SCAN_LIMIT: i64 = 5000;
/// Normalized text is truncated to this many chars before any edit-distance work.
const MAX_COMPARE_CHARS: usize = 512;
/// Sorted-neighbourhood window: each distinct entry is compared against this many
/// neighbours in each sort order. Keeps the near-duplicate pass linear in the item count.
const NEIGHBOURHOOD: usize = 32;
/// Perceptual hashes are only computed for this many images per scan, newest first.
const MAX_IMAGE_HASHES: usize = 800;
/// Buckets used by the cheap character-multiset gate.
const SIG_BUCKETS: usize = 64;

// ─── DTOs ───────────────────────────────────────────────────────────────────────

/// One entry inside a cluster.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DuplicateMember {
    pub item: ItemDto,
    /// How close this entry is to the cluster's keeper, `0.0..=1.0`. Exactly `1.0` means
    /// identical after normalization.
    pub similarity: f64,
    /// True when this entry may be proposed for removal: not the keeper, and not pinned.
    pub removable: bool,
}

/// A group of entries that are the same thing.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DuplicateCluster {
    /// Stable identity for the cluster across reloads — the keeper's item id.
    pub id: String,
    /// The entry suggested to survive: pinned first, then most-reused, then newest.
    pub keeper_id: String,
    /// Keeper first, then the rest ordered closest-match-first.
    pub members: Vec<DuplicateMember>,
}

// ─── Normalization ──────────────────────────────────────────────────────────────

/// Query parameters that carry no meaning for the destination — two URLs differing only
/// in these are the same link.
fn is_tracking_param(key: &str) -> bool {
    key.starts_with("utm_")
        || matches!(
            key,
            "fbclid"
                | "gclid"
                | "gbraid"
                | "wbraid"
                | "msclkid"
                | "yclid"
                | "dclid"
                | "igshid"
                | "mc_cid"
                | "mc_eid"
                | "_ga"
                | "_gl"
                | "ref"
                | "ref_src"
                | "ref_url"
                | "referrer"
                | "source"
                | "si"
                | "spm"
                | "trk"
                | "trk_contact"
                | "cmpid"
                | "campaign"
                | "feature"
                | "share"
        )
}

/// Reduces a URL to what actually identifies it: no scheme, no `www.`, no fragment, no
/// tracking parameters, no trailing slash, and remaining query parameters sorted so their
/// order stops mattering.
fn normalize_link(raw: &str) -> String {
    let lower = raw.trim().to_lowercase();
    let rest = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"))
        .unwrap_or(&lower);
    let rest = rest.strip_prefix("www.").unwrap_or(rest);
    let rest = rest.split('#').next().unwrap_or(rest);

    let (path, query) = match rest.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (rest, None),
    };
    let path = path.trim_end_matches('/');

    let mut kept: Vec<&str> = query
        .into_iter()
        .flat_map(|q| q.split('&'))
        .filter(|pair| !pair.is_empty())
        .filter(|pair| !is_tracking_param(pair.split('=').next().unwrap_or(pair)))
        .collect();
    kept.sort_unstable();

    if kept.is_empty() {
        path.to_string()
    } else {
        format!("{path}?{}", kept.join("&"))
    }
}

/// Reduces an entry to the form duplicate detection compares: lowercased, trimmed, with
/// every run of whitespace (including line endings) collapsed to a single space. Links
/// additionally lose their scheme, tracking parameters and trailing slash.
pub fn normalize(item_type: &str, content: &str) -> String {
    if item_type == "link" {
        return normalize_link(content);
    }
    let mut out = String::with_capacity(content.len());
    let mut in_space = false;
    for c in content.trim().chars() {
        if c.is_whitespace() {
            in_space = true;
            continue;
        }
        if in_space && !out.is_empty() {
            out.push(' ');
        }
        in_space = false;
        out.extend(c.to_lowercase());
    }
    out
}

// ─── Perceptual hashing ─────────────────────────────────────────────────────────

/// 64-bit difference hash: downscale to 9×8 greyscale, then record whether each pixel is
/// brighter than the one to its right. Resilient to re-encoding, rescaling and mild
/// quality loss, which is exactly how the same picture ends up in the history twice.
pub fn phash(bytes: &[u8]) -> Option<u64> {
    let img = image::load_from_memory(bytes).ok()?;
    let small = img.resize_exact(9, 8, image::imageops::FilterType::Triangle).to_luma8();
    let mut hash: u64 = 0;
    let mut bit = 0;
    for y in 0..8u32 {
        for x in 0..8u32 {
            if small.get_pixel(x, y).0[0] > small.get_pixel(x + 1, y).0[0] {
                hash |= 1u64 << bit;
            }
            bit += 1;
        }
    }
    Some(hash)
}

/// Similarity of two perceptual hashes: the share of the 64 bits that agree.
fn phash_similarity(a: u64, b: u64) -> f64 {
    1.0 - (a ^ b).count_ones() as f64 / 64.0
}

// ─── Cheap pre-DP gates ─────────────────────────────────────────────────────────

/// Character-multiset signature: how many characters fall into each of [`SIG_BUCKETS`]
/// buckets. The overlap between two signatures is an upper bound on their similarity, so
/// it rules pairs out before the quadratic edit-distance runs.
fn signature(chars: &[char]) -> [u16; SIG_BUCKETS] {
    let mut sig = [0u16; SIG_BUCKETS];
    for &c in chars {
        sig[(u32::from(c) as usize) % SIG_BUCKETS] = sig[(u32::from(c) as usize) % SIG_BUCKETS].saturating_add(1);
    }
    sig
}

/// Upper bound on similarity from the signatures alone: shared characters over the longer
/// entry. Cheap (64 comparisons) and never optimistic — if this is below the threshold,
/// the real similarity cannot reach it either.
fn signature_overlap(a: &[u16; SIG_BUCKETS], b: &[u16; SIG_BUCKETS], longest: usize) -> f64 {
    if longest == 0 {
        return 1.0;
    }
    let shared: u32 = a.iter().zip(b.iter()).map(|(x, y)| u32::from(*x.min(y))).sum();
    shared as f64 / longest as f64
}

// ─── Union-find ─────────────────────────────────────────────────────────────────

/// Disjoint-set over candidate indices, so a chain of pairwise matches (a≈b, b≈c) becomes
/// one cluster rather than two overlapping pairs.
struct UnionFind {
    parent: Vec<usize>,
}

impl UnionFind {
    fn new(n: usize) -> UnionFind {
        UnionFind { parent: (0..n).collect() }
    }
    fn find(&mut self, mut x: usize) -> usize {
        while self.parent[x] != x {
            self.parent[x] = self.parent[self.parent[x]]; // path halving
            x = self.parent[x];
        }
        x
    }
    fn union(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            self.parent[rb] = ra;
        }
    }
}

// ─── Candidates ─────────────────────────────────────────────────────────────────

/// One scanned item, prepared for comparison.
struct Candidate {
    item: ItemDto,
    /// Normalized text (empty for images that only have a perceptual hash).
    key: String,
    /// `key` as chars, truncated to [`MAX_COMPARE_CHARS`].
    chars: Vec<char>,
    sig: [u16; SIG_BUCKETS],
    phash: Option<u64>,
}

/// True for the types compared as pictures rather than as text.
fn is_image(item_type: &str) -> bool {
    matches!(item_type, "image" | "gif")
}

impl Storage {
    /// The configured similarity threshold, clamped to a sane range. Entries must be at
    /// least this alike to land in the same cluster.
    pub fn similarity_threshold(&self) -> f64 {
        self.get_setting(THRESHOLD_KEY)
            .ok()
            .flatten()
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| v.is_finite())
            .map(|v| v.clamp(0.5, 1.0))
            .unwrap_or(DEFAULT_THRESHOLD)
    }

    /// Persists the similarity threshold used by [`Storage::duplicate_clusters`].
    pub fn set_similarity_threshold(&self, value: f64) -> rusqlite::Result<()> {
        let clamped = if value.is_finite() { value.clamp(0.5, 1.0) } else { DEFAULT_THRESHOLD };
        self.set_setting(THRESHOLD_KEY, &format!("{clamped:.2}"))
    }

    /// Groups live items into clusters of identical / near-identical entries.
    ///
    /// Clusters are returned largest-first (then newest keeper) and always contain at
    /// least two members. Each cluster nominates a keeper — pinned wins, then the most
    /// reused, then the newest — and flags every other non-pinned member as removable.
    /// **Pinned entries are never removable**, so a cluster of two pinned items reports
    /// nothing to clean up.
    pub fn duplicate_clusters(&self) -> rusqlite::Result<Vec<DuplicateCluster>> {
        let threshold = self.similarity_threshold();
        let mut candidates = self.load_candidates()?;
        if candidates.len() < 2 {
            return Ok(vec![]);
        }

        let mut uf = UnionFind::new(candidates.len());
        // Pass 1 — identical after normalization. Also collapses each distinct key to a
        // single representative, so the expensive pass below sees far fewer entries.
        let mut representatives: Vec<usize> = Vec::new();
        let mut by_key: HashMap<(String, &str), usize> = HashMap::new();
        for i in 0..candidates.len() {
            if candidates[i].key.is_empty() {
                continue;
            }
            let bucket_type = if is_image(&candidates[i].item.item_type) { "image" } else { "text" };
            let key = (candidates[i].key.clone(), bucket_type);
            match by_key.get(&key) {
                Some(&first) => uf.union(first, i),
                None => {
                    by_key.insert(key, i);
                    representatives.push(i);
                }
            }
        }

        self.link_near_text(&candidates, &mut representatives, &mut uf, threshold);
        link_images(&candidates, &mut uf, threshold);

        Ok(build_clusters(&mut candidates, &mut uf))
    }

    /// How many entries the "Similar" view would offer to remove — every non-keeper,
    /// non-pinned member across all clusters. Drives the sidebar badge.
    pub fn duplicate_count(&self) -> rusqlite::Result<i64> {
        Ok(self
            .duplicate_clusters()?
            .iter()
            .flat_map(|c| c.members.iter())
            .filter(|m| m.removable)
            .count() as i64)
    }

    /// Loads the newest [`SCAN_LIMIT`] live items and prepares each for comparison,
    /// computing (and caching) perceptual hashes for images along the way.
    fn load_candidates(&self) -> rusqlite::Result<Vec<Candidate>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {ITEM_COLS}, phash FROM items
             WHERE deleted_at IS NULL
             ORDER BY created_at DESC LIMIT {SCAN_LIMIT}"
        ))?;
        let rows: Vec<(ItemDto, Option<i64>)> = stmt
            .query_map([], |r| Ok((map_item(r)?, r.get::<_, Option<i64>>(12)?)))?
            .collect::<rusqlite::Result<_>>()?;
        drop(stmt);

        let mut hashed = 0usize;
        let mut out = Vec::with_capacity(rows.len());
        for (item, stored_phash) in rows {
            let image = is_image(&item.item_type);
            let mut phash_value = stored_phash.map(|v| v as u64);

            if image && phash_value.is_none() && hashed < MAX_IMAGE_HASHES {
                hashed += 1;
                // Prefer the small WebP preview — same picture, a fraction of the decode
                // cost. Fall back to the original when no thumbnail was generated.
                let source = item.preview_path.as_deref().or(item.file_path.as_deref());
                if let Some(h) = source
                    .and_then(|p| std::fs::read(p).ok())
                    .and_then(|bytes| phash(&bytes))
                {
                    // Cache it: hashing an image is the expensive part of this scan and
                    // the picture never changes once captured.
                    conn.execute(
                        "UPDATE items SET phash = ?1 WHERE id = ?2",
                        params![h as i64, item.id],
                    )?;
                    phash_value = Some(h);
                }
            }

            // Images compare by picture; their OCR text stands in when the file is gone
            // or unreadable, so a screenshot is still matched by the words in it.
            let key = if image {
                String::new()
            } else {
                normalize(&item.item_type, item.content.as_deref().unwrap_or(""))
            };
            let chars: Vec<char> = key.chars().take(MAX_COMPARE_CHARS).collect();
            let sig = signature(&chars);
            out.push(Candidate { item, key, chars, sig, phash: phash_value });
        }
        Ok(out)
    }

    /// Links near-identical text entries. Representatives are visited in two sort orders
    /// (by key, and by reversed key) and each is only compared against its
    /// [`NEIGHBOURHOOD`] nearest neighbours — near-identical strings sort next to each
    /// other, so this finds the same pairs an all-pairs sweep would without its cost.
    fn link_near_text(
        &self,
        candidates: &[Candidate],
        representatives: &mut Vec<usize>,
        uf: &mut UnionFind,
        threshold: f64,
    ) {
        let text_reps: Vec<usize> = representatives
            .iter()
            .copied()
            .filter(|&i| !is_image(&candidates[i].item.item_type) && !candidates[i].chars.is_empty())
            .collect();
        if text_reps.len() < 2 {
            return;
        }

        let forward = {
            let mut v = text_reps.clone();
            v.sort_by(|&a, &b| candidates[a].key.cmp(&candidates[b].key));
            v
        };
        let backward = {
            let reversed: HashMap<usize, String> = text_reps
                .iter()
                .map(|&i| (i, candidates[i].key.chars().rev().collect()))
                .collect();
            let mut v = text_reps;
            v.sort_by(|a, b| reversed[a].cmp(&reversed[b]));
            v
        };

        for order in [forward, backward] {
            for (pos, &i) in order.iter().enumerate() {
                let upper = (pos + 1 + NEIGHBOURHOOD).min(order.len());
                for &j in &order[pos + 1..upper] {
                    if candidates[i].item.item_type != candidates[j].item.item_type {
                        continue;
                    }
                    if uf.find(i) == uf.find(j) {
                        continue;
                    }
                    if pair_similarity(&candidates[i], &candidates[j], threshold) >= threshold {
                        uf.union(i, j);
                    }
                }
            }
        }
    }
}

/// Similarity of two text candidates, `0.0` when either cheap gate rules the pair out
/// before the edit distance is worth computing.
fn pair_similarity(a: &Candidate, b: &Candidate, threshold: f64) -> f64 {
    let longest = a.chars.len().max(b.chars.len());
    let shortest = a.chars.len().min(b.chars.len());
    if longest == 0 {
        return 0.0;
    }
    // Length alone caps similarity: the extra characters are all edits.
    if (shortest as f64) / (longest as f64) < threshold {
        return 0.0;
    }
    if signature_overlap(&a.sig, &b.sig, longest) < threshold {
        return 0.0;
    }
    ratio(&a.chars, &b.chars)
}

/// Links images whose perceptual hashes agree closely enough. Images are a small slice of
/// a typical history, and a hash comparison is a single XOR, so this stays all-pairs.
fn link_images(candidates: &[Candidate], uf: &mut UnionFind, threshold: f64) {
    let images: Vec<(usize, u64)> = candidates
        .iter()
        .enumerate()
        .filter(|(_, c)| is_image(&c.item.item_type))
        .filter_map(|(i, c)| c.phash.map(|h| (i, h)))
        .collect();

    for (pos, &(i, hi)) in images.iter().enumerate() {
        for &(j, hj) in &images[pos + 1..] {
            if phash_similarity(hi, hj) >= threshold {
                uf.union(i, j);
            }
        }
    }
}

/// Turns the union-find groups into ordered clusters: picks each keeper, scores every
/// member against it, and drops groups that ended up with a single entry.
fn build_clusters(candidates: &mut [Candidate], uf: &mut UnionFind) -> Vec<DuplicateCluster> {
    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..candidates.len() {
        groups.entry(uf.find(i)).or_default().push(i);
    }

    let mut clusters: Vec<DuplicateCluster> = groups
        .into_values()
        .filter(|g| g.len() > 1)
        .map(|group| {
            // Keeper: a pinned entry always survives; otherwise the one the user actually
            // reaches for, and finally the newest.
            let keeper = *group
                .iter()
                .max_by(|&&a, &&b| {
                    let ka = &candidates[a].item;
                    let kb = &candidates[b].item;
                    ka.pinned
                        .cmp(&kb.pinned)
                        .then(ka.reuse_count.cmp(&kb.reuse_count))
                        .then(ka.copy_count.cmp(&kb.copy_count))
                        .then(ka.created_at.cmp(&kb.created_at))
                })
                .expect("group is non-empty");

            let mut members: Vec<DuplicateMember> = group
                .iter()
                .map(|&i| {
                    let similarity = if i == keeper {
                        1.0
                    } else if is_image(&candidates[i].item.item_type) {
                        match (candidates[i].phash, candidates[keeper].phash) {
                            (Some(a), Some(b)) => phash_similarity(a, b),
                            _ => 1.0,
                        }
                    } else if candidates[i].key == candidates[keeper].key {
                        1.0
                    } else {
                        ratio(&candidates[i].chars, &candidates[keeper].chars)
                    };
                    DuplicateMember {
                        item: candidates[i].item.clone(),
                        similarity,
                        removable: i != keeper && !candidates[i].item.pinned,
                    }
                })
                .collect();

            let keeper_id = candidates[keeper].item.id.clone();
            // Keeper first, then closest match, then newest.
            members.sort_by(|a, b| {
                (a.item.id == keeper_id)
                    .cmp(&(b.item.id == keeper_id))
                    .reverse()
                    .then(
                        b.similarity
                            .partial_cmp(&a.similarity)
                            .unwrap_or(std::cmp::Ordering::Equal),
                    )
                    .then(b.item.created_at.cmp(&a.item.created_at))
            });

            DuplicateCluster { id: keeper_id.clone(), keeper_id, members }
        })
        .collect();

    // Biggest mess first; then the most recent cluster.
    clusters.sort_by(|a, b| {
        b.members
            .len()
            .cmp(&a.members.len())
            .then(b.members[0].item.created_at.cmp(&a.members[0].item.created_at))
    });
    clusters
}
