#!/bin/bash
#
# "Uninstall Trade Assistant.app" — removes everything the app created.
#
# Dragging the app to the Trash leaves its private environment behind in
# Application Support (a couple of hundred megabytes), so this clears that
# and offers to remove the app itself.

set -uo pipefail

SUPPORT="$HOME/Library/Application Support/Trade Assistant"
APP_GUESSES=(
  "/Applications/Trade Assistant.app"
  "$HOME/Applications/Trade Assistant.app"
  "$HOME/Downloads/Trade Assistant.app"
  "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/Trade Assistant.app"
)

human_size() {
  [ -d "$1" ] && du -sh "$1" 2>/dev/null | cut -f1 | tr -d ' ' || echo "0B"
}

if [ ! -d "$SUPPORT" ]; then
  FOUND_APP=""
  for a in "${APP_GUESSES[@]}"; do [ -d "$a" ] && FOUND_APP="$a" && break; done
  if [ -z "$FOUND_APP" ]; then
    osascript -e 'display alert "Nothing to remove" message "Trade Assistant does not appear to be installed on this Mac." buttons {"OK"} default button 1' >/dev/null 2>&1
    exit 0
  fi
fi

SIZE=$(human_size "$SUPPORT")

CHOICE=$(osascript <<AS 2>/dev/null
display alert "Remove Trade Assistant?" message "This deletes its saved settings and its private environment (${SIZE}).

Your watchlist and preferences are stored in your browser and are not touched." buttons {"Cancel", "Remove"} default button "Cancel" as critical
return button returned of result
AS
)

[ "$CHOICE" = "Remove" ] || exit 0

rm -rf "$SUPPORT"

# Offer to bin the application itself. Moving to Trash rather than deleting
# outright, so it is recoverable.
APP=""
for a in "${APP_GUESSES[@]}"; do [ -d "$a" ] && APP="$a" && break; done

if [ -n "$APP" ]; then
  ALSO=$(osascript <<AS 2>/dev/null
display alert "Also move the app to the Trash?" message "Found it at:
$APP" buttons {"Keep it", "Move to Trash"} default button "Move to Trash"
return button returned of result
AS
)
  if [ "$ALSO" = "Move to Trash" ]; then
    osascript -e "tell application \"Finder\" to delete POSIX file \"$APP\"" >/dev/null 2>&1
  fi
fi

osascript -e 'display alert "Removed" message "Trade Assistant has been uninstalled. Thanks for trying it." buttons {"OK"} default button 1' >/dev/null 2>&1
