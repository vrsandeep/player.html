#!/bin/sh
# Turns on HTTP Basic authentication for the library and player.
#
#   AUTH_USERNAME + AUTH_PASSWORD  A single user.
#   AUTH_HTPASSWD                  Path to an htpasswd file (several users, pre-hashed passwords).
#
# With neither set the server stays open. A half-configured setup stops the container
# instead of silently serving without a password.
set -eu

conf=/etc/nginx/player-auth.conf
htpasswd=/etc/nginx/player.htpasswd

fail() {
    echo "$0: $*" >&2
    exit 1
}

if [ -n "${AUTH_HTPASSWD:-}" ]; then
    [ -z "${AUTH_USERNAME:-}${AUTH_PASSWORD:-}" ] || fail "set AUTH_HTPASSWD or AUTH_USERNAME/AUTH_PASSWORD, not both"
    [ -r "$AUTH_HTPASSWD" ] || fail "AUTH_HTPASSWD file $AUTH_HTPASSWD is not readable"
    grep -q '^[^#:][^:]*:.' "$AUTH_HTPASSWD" || fail "AUTH_HTPASSWD file $AUTH_HTPASSWD has no user:hash entries"
    cp "$AUTH_HTPASSWD" "$htpasswd"
elif [ -n "${AUTH_USERNAME:-}${AUTH_PASSWORD:-}" ]; then
    [ -n "${AUTH_USERNAME:-}" ] || fail "AUTH_PASSWORD is set but AUTH_USERNAME is empty"
    [ -n "${AUTH_PASSWORD:-}" ] || fail "AUTH_USERNAME is set but AUTH_PASSWORD is empty"
    case "$AUTH_USERNAME" in
        *:*) fail "AUTH_USERNAME must not contain ':'" ;;
    esac
    hash=$(printf '%s\n' "$AUTH_PASSWORD" | openssl passwd -apr1 -stdin)
    printf '%s:%s\n' "$AUTH_USERNAME" "$hash" > "$htpasswd"
else
    echo 'auth_basic off;' > "$conf"
    echo "$0: authentication disabled (set AUTH_USERNAME and AUTH_PASSWORD to enable)"
    exit 0
fi

chown root:nginx "$htpasswd"
chmod 640 "$htpasswd"
cat > "$conf" <<EOF
auth_basic "player.html";
auth_basic_user_file $htpasswd;
EOF
echo "$0: authentication enabled"
