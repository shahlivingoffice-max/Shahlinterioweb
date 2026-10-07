# SECUREX Customer Support Form

The form lives on **shahinterio.com/support/** and the data lands in **your Google Sheet**.

```
shahinterio.com/support/        Apps Script web app (/exec)      Google Sheet + Drive
  (GitHub Pages, your domain)  ──── POST JSON ───────────────▶   "Support Tickets" tab
  support/index.html                doPost() in Code.gs          + ticket folder of photos,
                                                                   videos, voice notes
```

The customer picks a **Query Type** first, then gets the right form.

| | Enquiry / Question | Complaint |
|---|---|---|
| Unique Code | required | required |
| Store Name | required | required |
| City | required | required |
| Your Query | required | required |
| Photos | optional | **at least 1 required** (up to 10) |
| Videos | optional (up to 3) | optional (up to 3) |
| Voice note | optional | optional |

Every submission writes one row to the **Support Tickets** sheet and drops the attachments into a
Drive folder named after the ticket id (`SX-20261006-001 - Store Name`). Links to the files land in
the sheet row and in the notification email.

## Files

**On your website repo** (already placed):

| File | Purpose |
|---|---|
| `Shahlinterioweb-main/support/index.html` | The whole form - one self-contained page, styled to match the site |

**In the Apps Script project** (`securex-support-form/`):

| File | Purpose |
|---|---|
| `Code.gs` | Config, JSON API (`doPost`), sheet + Drive handling, chunked uploads, validation, email, `onEdit` |
| `Index.html`, `CSS.html`, `JS.html` | A backup copy of the form served from the `/exec` URL itself |
| `appsscript.json` | Manifest (IST, V8, anonymous access) |

The backup form and the website form are **separate copies**. Changing the look on the website does
not change the backup, and vice versa. If that ever gets confusing, the three HTML files can be
deleted - the website page does not need them.

## Setup - do this in order

### 1. Apps Script (the backend)

1. Open the Google Sheet that should hold the tickets → **Extensions → Apps Script**.
2. Create `Code.gs`, `Index.html`, `CSS.html`, `JS.html` with exactly those names and paste the
   contents in. (`Index`, `CSS`, `JS` are HTML files.)
3. Edit `CONFIG` at the top of `Code.gs`:
   - `ADMIN_EMAILS` – who gets the new-ticket email (comma separated). Blank = no email.
   - `SUPPORT_PHONE` – shown on the form. e.g. `+91 91795 39610`.
   - `DRIVE_FOLDER_ID` – optional. Blank = the script creates and remembers its own folder.
   - `ASK_PHONE` – `true` adds an optional Mobile Number field.
   - `SHARE_LINKS` – `true` (default) = attachment links open for anyone with the link.
4. Run `setup` once and approve the permissions.
5. **Deploy → New deployment → Web app** · Execute as **Me** · Who has access: **Anyone**.
   Copy the `/exec` URL.

> "Anyone" is required — your customers are not signed in to Google. It does not expose your sheet;
> it only exposes the actions in `Code.gs`.

### 2. Website (the form)

1. Open `support/index.html` and replace the placeholder near the top of the script:
   ```js
   const API_URL = 'https://script.google.com/macros/s/AKfy..../exec';
   ```
2. Commit the `support/` folder to your GitHub Pages repo and push.
3. The form is live at **https://shahinterio.com/support/**.

Optional — add it to the site menu in `index.html`, after the Contact item:

```html
<li><a href="/support/">Support</a></li>
```

### 3. After any change to `Code.gs`

**Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy.** The `/exec` URL
stays the same, so the website needs no change. Skipping this step is the usual reason "my edit did
nothing".

## How the connection works

Apps Script cannot answer a CORS preflight, so the page sends a **simple request**: a POST with
`Content-Type: text/plain` carrying JSON, no custom headers. `doPost` parses it and routes on
`action`: `config`, `draft`, `chunk`, `discard`, `submit`. Responses are JSON.

Don't add headers (auth tokens, `application/json`) to that fetch — any of them triggers a
preflight that Apps Script answers with an error, and every submission starts failing.

## How uploads work

Apps Script cannot take a large file in one call, so the browser:

1. compresses photos to max 1600 px / JPEG 0.82 (a 4 MB phone photo becomes ~300 KB),
2. slices each file into 1,800,000-byte pieces — a multiple of 3, so the base64 pieces concatenate
   without padding problems,
3. uploads the pieces as the files are chosen, while the customer is still typing.

The server stores pieces in a `_parts` subfolder, joins them on the last piece, writes the real
file, deletes the parts. Files go into a `DRAFT-…` folder that is renamed to the ticket id on
submit, so a half-filled form never creates a ticket.

Caps live in `CONFIG`: 12 MB per photo, 40 MB per video, 15 MB per voice note, 3 minutes of
recording. Submit waits for any still-uploading file and shows a progress bar.

Optional: **Triggers → Add trigger → `cleanupDrafts` → Day timer** deletes `DRAFT-…` folders from
customers who uploaded files and then closed the page.

## Voice notes

On **shahinterio.com** the page is a normal HTTPS page on your own domain, so in-page recording with
the microphone works properly — record, play it back, re-record, submit. If a browser still refuses
(old phone, denied permission), it falls back to opening the phone's own recorder app and the
customer picks the recording. Either way the audio reaches the ticket folder.

(The backup form served from the `/exec` URL runs inside Google's sandboxed iframe, where the
microphone is usually blocked, so there it almost always uses the fallback. That is the main reason
the website copy is the better one to hand to customers.)

## Sheet columns

`Ticket ID · Timestamp · Query Type · Unique Code · Store Name · City · Mobile · Your Query ·
Images · Videos · Voice Note · Attachments Folder · Status · Assigned To · Resolved On · Remarks`

`Status` is a dropdown (New / In Progress / Waiting for Customer / Resolved / Closed). Setting it to
Resolved or Closed stamps `Resolved On` automatically; changing it back clears the stamp.

## Notes

- No Name / Email / Phone field by default — the fields are Unique Code, Store Name, City, Query.
  Set `ASK_PHONE: true` for a callback number. With no customer email captured, no acknowledgement
  email is sent; the ticket id on screen is the customer's reference.
- Validation runs in the browser **and** again on the server, including "a complaint must have a
  photo". The server counts the files actually present in the Drive folder rather than trusting the
  browser.
- A hidden honeypot field blocks the simplest bots. Because the endpoint is public, anyone who finds
  the `/exec` URL can post to it — the ticket id and the `New` status make junk easy to spot, and
  `cleanupDrafts` clears abandoned uploads.
