#!/bin/sh
# Refresh the icon-theme and desktop-entry caches so GNOME picks up ClipVault's
# launcher icon immediately after install (otherwise the dock may show a fallback
# icon until the next cache rebuild / re-login).
set -e

if [ "$1" = "configure" ] || [ "$1" = "abort-upgrade" ]; then
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
        gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor >/dev/null 2>&1 || true
    fi
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database -q /usr/share/applications >/dev/null 2>&1 || true
    fi
fi

exit 0
