# Memory host access

The memory scripts connect to a hosted OmniRoute memory API, for example `https://te-memory.example.com`. Cloudflare Access must protect this host. The scripts send a Cloudflare Access service token with each request.

## What the scripts do

- `scripts/omniroute-memory-sync.sh` and `scripts/omniroute-memory-retrieve.sh` read the origin from `TEMPERANCE_OMNIROUTE_ADMIN_URL`.
- For a loopback origin, the scripts send no token.
- For a remote origin, the scripts load the token before they read the admin password.
- If there is no token, the scripts stop. They do not send the admin password.
- The scripts write the token to a temporary file that only the owner can read. The token is not in the command arguments.

## Set up Cloudflare Access

Do these steps in the Cloudflare Zero Trust dashboard.

1. Create a service token with the name `te-memory-scripts`. Record the client ID and the client secret.
2. Create a self-hosted Access application for the memory host.
3. Add a policy with the action **Service Auth**. Include the `te-memory-scripts` token in the policy.
4. Create a second Access application for the `/api/health` path on the memory host. Add a policy with the action **Bypass** for everyone. The organ doctor uses this path.
5. Send a request without a token to `/api/auth/login`. Make sure that Access sends a redirect to its login page.

## Change the default password

Do not keep the OmniRoute default admin password `CHANGEME`. All people know this password. Change it in the dashboard before you use the memory host. Then put the new password in the `OmniRoute Temperance Admin` Keychain item.

## Store the token on a Mac

Run each command. Each command asks for the value. The value does not show on the screen.

```bash
security add-generic-password -U -a "$USER" -s "OmniRoute Temperance Access Client ID" -w
```

```bash
security add-generic-password -U -a "$USER" -s "OmniRoute Temperance Access Client Secret" -w
```

On a host without the Keychain, set `TEMPERANCE_OMNIROUTE_ACCESS_CLIENT_ID` and `TEMPERANCE_OMNIROUTE_ACCESS_CLIENT_SECRET`.

## Do a check

```bash
scripts/omniroute-memory-retrieve.sh "release"
```

If Access does not accept the token, the script shows `Cloudflare Access did not accept the service token`. Examine the policy and the token.

## Private networks

A private network can protect a remote origin. For that origin, set `TEMPERANCE_OMNIROUTE_ALLOW_REMOTE_LOGIN_WITHOUT_ACCESS=1`. The script then shows a caution and sends no token. Do not set this variable for a public host.
