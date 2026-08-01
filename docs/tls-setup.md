# TLS setup

The server can listen over HTTPS if `TLS_PFX_PATH`/`TLS_PFX_PASSPHRASE` are set in
`packages/server/.env`. Leave both unset to run over plain HTTP — appropriate if TLS is
terminated by a reverse proxy (nginx, IIS, Caddy) in front of this server instead.

## Dev/test: self-signed certificate

Generated once via PowerShell (Windows), no OpenSSL needed:

```powershell
$cert = New-SelfSignedCertificate -DnsName "<machine-hostname>","localhost" `
  -CertStoreLocation "cert:\CurrentUser\My" -NotAfter (Get-Date).AddYears(2) `
  -KeyExportPolicy Exportable -KeyUsage DigitalSignature,KeyEncipherment `
  -Type SSLServerAuthentication -FriendlyName "EndpointManager Dev TLS"

$pwd = ConvertTo-SecureString -String "<a-strong-random-passphrase>" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath "packages\server\certs\dev-server.pfx" -Password $pwd

# Public half only (no private key) — this is what the agent trusts, see below.
Export-Certificate -Cert $cert -FilePath "packages\agent\certs-trust\dev-server-public.cer"
```

The exported `.cer` is DER-encoded; convert it to PEM (what the agent's axios `ca` option
expects) via .NET directly — no OpenSSL required:

```powershell
$c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2("dev-server-public.cer")
$b64 = [Convert]::ToBase64String($c.RawData, [System.Base64FormattingOptions]::InsertLineBreaks)
"-----BEGIN CERTIFICATE-----`n$b64`n-----END CERTIFICATE-----`n" |
  Set-Content "packages\agent\certs-trust\dev-server-public.pem" -NoNewline
```

`packages/server/certs/` and `packages/agent/certs-trust/` are both gitignored — the PFX
(private key) and the trust bundle are per-environment, not checked in.

The agent trusts this specific certificate (via `UEM_SERVER_CA_PATH`, defaulting to
`certs-trust/dev-server-public.pem` if present) rather than disabling TLS verification —
it will refuse any OTHER certificate, so this isn't a blanket MITM bypass, just a
narrower trust root than the public CA system for this one self-signed cert.

## Production

Use a certificate from a real CA (public or an internal PKI), or terminate TLS at a
reverse proxy and leave `TLS_PFX_PATH` unset so the app listens over plain HTTP on the
loopback interface behind it. Either way, point the agent's `UEM_SERVER_URL` at the
`https://` address and remove the dev self-signed cert from `certs-trust/` (a real
publicly-trusted cert needs no special trust bundle — Node validates it against the OS
trust store automatically).
