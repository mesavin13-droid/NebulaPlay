#!/usr/bin/env bash
set -euo pipefail

release_id="${1:?release id required}"
expected_checksum="${2:?sha256 required}"
archive="/tmp/nebulaplay-release-${release_id}.tar.gz"
release_dir="/opt/nebulaplay/releases/${release_id}"

printf '%s  %s\n' "${expected_checksum}" "${archive}" | sha256sum -c -

if ! id -u nebulaplay >/dev/null 2>&1; then
  useradd --system --home-dir /opt/nebulaplay --shell /usr/sbin/nologin --no-create-home nebulaplay
fi

install -d -m 0755 /opt/nebulaplay/releases /var/www/nebu.life /var/www/letsencrypt
install -d -m 0755 "${release_dir}"
tar -xzf "${archive}" -C "${release_dir}"

(
  cd "${release_dir}"
  npm install --omit=dev --ignore-scripts --no-audit --no-fund --package-lock=false
)

chown -R root:root "${release_dir}"
chmod -R go-w "${release_dir}"

ln -sfn "${release_dir}" /opt/nebulaplay/current
ln -sfn /opt/nebulaplay/current/dist /var/www/nebu.life/current

install -m 0644 /tmp/nebulaplay-proxy.service /etc/systemd/system/nebulaplay-proxy.service
nginx_config=/tmp/nebu.life.http.conf
if [ -f /etc/letsencrypt/live/nebu.life/fullchain.pem ] && [ -f /tmp/nebu.life.https.conf ]; then
  nginx_config=/tmp/nebu.life.https.conf
fi
install -m 0644 "${nginx_config}" /etc/nginx/sites-available/nebu.life
ln -sfn /etc/nginx/sites-available/nebu.life /etc/nginx/sites-enabled/nebu.life
rm -f /etc/nginx/sites-enabled/default

systemctl daemon-reload
systemctl enable nebulaplay-proxy.service
systemctl restart nebulaplay-proxy.service
nginx -t
if systemctl is-active --quiet nginx.service; then
  /usr/sbin/nginx -s reload
else
  systemctl start nginx.service
fi

for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8787/healthz; then
    break
  fi
  if [ "${attempt}" -eq 30 ]; then
    systemctl status nebulaplay-proxy.service --no-pager -l
    exit 1
  fi
  sleep 1
done
curl -fsS -H 'Host: nebu.life' http://127.0.0.1/ >/dev/null
