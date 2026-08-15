//! Edit-distance matching for search ranking.
//!
//! Search must never come back empty while the user is typing: whatever is in the box,
//! the closest items should surface. A plain Levenshtein distance between the query and
//! the *whole* item content can't do that — a 2 KB clipboard entry always scores terribly
//! against a 6-character query. So we measure the distance to the **best-matching window**
//! of the item instead: the classic approximate-substring variant of the DP, where the
//! alignment may start and end anywhere in the haystack.
//!
//! A [`Matcher`] is built once per query and reused across every candidate item, which is
//! what keeps a full-history scan cheap. For queries up to 64 characters it runs Myers'
//! bit-parallel algorithm (one machine word per haystack character, O(n) per item);
//! longer queries fall back to a rolling two-row DP.

use std::collections::HashMap;

/// Haystacks are truncated to this many characters before scoring, so a huge pasted
/// document can't make a keystroke expensive. The exact-phrase FTS path (`Storage::search`)
/// still covers the full text.
pub const MAX_HAYSTACK_CHARS: usize = 4000;

/// Widest query the bit-parallel path can handle (one `u64` per DP column).
const BITPARALLEL_MAX: usize = 64;

/// Score floor for a literal substring hit. Every near-miss scores below 1.0, so an item
/// that genuinely contains the query always outranks one that merely resembles it.
const EXACT_BASE: f64 = 2.0;
/// Added when a literal hit starts at a word boundary ("git" in "git push", not in "digit").
const BOUNDARY_BONUS: f64 = 0.5;
/// Added, scaled by how early the literal hit appears in the haystack.
const EARLINESS_BONUS: f64 = 0.25;

/// A prepared query. Build once, score many haystacks against it.
pub struct Matcher {
    /// Lowercased, trimmed query text — used for the literal-substring fast path.
    needle: String,
    /// The same query as chars, for the distance algorithms.
    pat: Vec<char>,
    /// Myers' match masks for ASCII, indexed by byte; bit `i` is set when `pat[i] == c`.
    peq_ascii: Box<[u64; 128]>,
    /// Match masks for any non-ASCII characters in the query.
    peq_other: HashMap<char, u64>,
    /// False when the query is longer than [`BITPARALLEL_MAX`] and we must use the DP.
    bit_parallel: bool,
}

impl Matcher {
    /// Prepares `needle` (expected already trimmed and lowercased) for repeated matching.
    /// Returns `None` for an empty query — there is nothing to rank by.
    pub fn new(needle: &str) -> Option<Matcher> {
        let pat: Vec<char> = needle.chars().collect();
        if pat.is_empty() {
            return None;
        }
        let bit_parallel = pat.len() <= BITPARALLEL_MAX;
        let mut peq_ascii = Box::new([0u64; 128]);
        let mut peq_other: HashMap<char, u64> = HashMap::new();
        if bit_parallel {
            for (i, &c) in pat.iter().enumerate() {
                let bit = 1u64 << i;
                match u32::from(c) {
                    code if code < 128 => peq_ascii[code as usize] |= bit,
                    _ => *peq_other.entry(c).or_insert(0) |= bit,
                }
            }
        }
        Some(Matcher { needle: needle.to_string(), pat, peq_ascii, peq_other, bit_parallel })
    }

    /// The query's character length — the yardstick distances are normalised against.
    fn len(&self) -> usize {
        self.pat.len()
    }

    /// Ranks `haystack` (expected already lowercased) against the query. Higher is closer.
    ///
    /// - `>= 2.0` — the haystack literally contains the query, with bonuses for a
    ///   word-boundary start and for appearing early.
    /// - `(0.0, 1.0)` — a near miss, `1 / (1 + distance / query_len)`. Strictly decreasing
    ///   in edit distance and never zero, so even a hopeless query still produces a total
    ///   ordering rather than a wall of ties.
    pub fn score(&self, haystack: &str) -> f64 {
        if haystack.is_empty() {
            return 0.0;
        }
        if let Some(pos) = haystack.find(&self.needle) {
            let boundary = haystack[..pos]
                .chars()
                .next_back()
                .map_or(true, |c| !c.is_alphanumeric());
            let earliness = 1.0 - (pos as f64 / haystack.len() as f64);
            return EXACT_BASE
                + if boundary { BOUNDARY_BONUS } else { 0.0 }
                + EARLINESS_BONUS * earliness;
        }
        let text: Vec<char> = haystack.chars().take(MAX_HAYSTACK_CHARS).collect();
        let distance = self.best_window_distance(&text);
        1.0 / (1.0 + distance as f64 / self.len() as f64)
    }

    /// Minimum edit distance between the query and *any* substring of `text`.
    fn best_window_distance(&self, text: &[char]) -> usize {
        if self.bit_parallel {
            self.myers_distance(text)
        } else {
            dp_best_window_distance(&self.pat, text)
        }
    }

    /// Myers' bit-parallel approximate-substring search: one `u64` carries the whole DP
    /// column, so each haystack character costs a handful of word operations regardless
    /// of query length.
    fn myers_distance(&self, text: &[char]) -> usize {
        let m = self.pat.len();
        let mask = if m == 64 { u64::MAX } else { (1u64 << m) - 1 };
        let high = 1u64 << (m - 1);

        let mut vp: u64 = mask;
        let mut vn: u64 = 0;
        let mut score = m;
        let mut best = m;

        for &c in text {
            let eq = match u32::from(c) {
                code if code < 128 => self.peq_ascii[code as usize],
                _ => self.peq_other.get(&c).copied().unwrap_or(0),
            };
            let xv = eq | vn;
            let xh = (((eq & vp).wrapping_add(vp)) ^ vp) | eq;
            let mut ph = vn | !(xh | vp);
            let mut mh = vp & xh;
            if ph & high != 0 {
                score += 1;
            } else if mh & high != 0 {
                score -= 1;
            }
            ph = (ph << 1) & mask;
            mh = (mh << 1) & mask;
            vp = (mh | !(xv | ph)) & mask;
            vn = ph & xv;
            if score < best {
                best = score;
                if best == 0 {
                    break;
                }
            }
        }
        best
    }
}

/// Rolling two-row DP fallback for queries wider than one machine word. Row 0 is held at
/// zero so the alignment may start anywhere; the answer is the smallest value the last
/// row ever takes, i.e. it may also end anywhere.
fn dp_best_window_distance(pat: &[char], text: &[char]) -> usize {
    let m = pat.len();
    let mut prev: Vec<usize> = (0..=m).collect();
    let mut cur: Vec<usize> = vec![0; m + 1];
    let mut best = m;

    for &tc in text {
        cur[0] = 0;
        for i in 1..=m {
            let cost = usize::from(pat[i - 1] != tc);
            cur[i] = (prev[i - 1] + cost).min(prev[i] + 1).min(cur[i - 1] + 1);
        }
        if cur[m] < best {
            best = cur[m];
            if best == 0 {
                break;
            }
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    best
}
