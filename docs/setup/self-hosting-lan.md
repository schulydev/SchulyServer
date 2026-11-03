# Run without a domain

Run Schuly on your local network to test it, for example with a phone on the same Wi-Fi. Without
a domain there is no certificate, so traffic is plain HTTP. Use this setup for testing only.

Follow [Self-host Schuly](self-hosting.md) with the changes below. The examples use `192.168.1.42`
as your computer's address.

## 1. Set the address

Skip the DNS step. In `.env`, set:

```sh
API_HOST=192.168.1.42
```

## 2. Serve plain HTTP

Replace the contents of `Caddyfile`:

```
http://{$API_HOST}:8080 {
	reverse_proxy backend:8080
}
```

In `compose.staging.yml`, replace the `ports` of the `caddy` service:

```yaml
    ports:
      - "8080:8080"
```

## 3. Fix the mail links

In `config/backend.env`, set:

```
Email__Smtp__PasswordResetLinkTemplate=http://${API_HOST}:8080/reset-password?token={token}
Email__Smtp__EmailVerificationLinkTemplate=http://${API_HOST}:8080/verify-email?token={token}
```

## 4. Start and check

```sh
docker compose -f compose.staging.yml up -d
curl http://192.168.1.42:8080/api/app/school-systems
```

In the app, enter `http://192.168.1.42:8080` as the **Backend URL**.

## Troubleshooting

**The phone can't reach the server.** On Windows, the firewall may block it. Allow Docker Desktop
on private networks, or add an inbound rule for port 8080.

**A `nip.io` or `sslip.io` address doesn't resolve.** Many home routers block public names that
point to private addresses. Use the IP address instead.

**The address stopped working.** Your router may have assigned a new IP address. Update `API_HOST`
and restart, or reserve the address in your router.
