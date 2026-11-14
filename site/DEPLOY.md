# Deploying dead-man-switch.chainsolution.net

`site/` is the deploy root: static files, no build step for the pages. `/` picks the visitor's language
(`localStorage`, then `navigator.languages`) and redirects to `/en/`, `/fr/` or `/de/`; without JavaScript it
shows the three links. `site/app/` receives the build of `app/` (`scripts/build-site.sh`, spec 03).

nginx example:

```nginx
server {
    listen 443 ssl http2;
    server_name dead-man-switch.chainsolution.net;
    root /var/www/dead-man-switch.chainsolution.net;   # = site/
    index index.html;
    error_page 404 /404.html;
    location / { try_files $uri $uri/ =404; }
    location /app/ { try_files $uri $uri/ /app/index.html; }
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy no-referrer;
    add_header Content-Security-Policy "default-src 'self'; connect-src 'self' https://testnet.ckb.dev https://mainnet.ckb.dev https://csr-monitor.chainsolution.net https://crt.chainsolution.net https://*.joy.id; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; frame-src https://*.joy.id";
}
```

`connect-src` and `frame-src` follow what the built app needs (JoyID opens a popup/iframe on `*.joy.id`; the CRT
deployment file lists the RPC URLs). Spec 03 phase 2 writes the exact list here after the first build.
Check after deploying: the three language pages load, `/` redirects, and the network tab shows no request
leaving the origin except those in `connect-src`.
