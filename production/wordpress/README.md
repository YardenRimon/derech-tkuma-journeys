# WordPress content foundation

`wp-content/mu-plugins/derech-content.php` is an automatically loaded WordPress must-use plugin. It adds **מסלולים** and **מועדי סיור** to `wp-admin`. Editors with the ordinary `edit_posts`/`publish_posts` permissions can create drafts, edit the Hebrew fields, and publish once the required data has been saved and confirmed. WordPress provides authentication and editor permissions; this plugin adds no login system.

The plugin does not write to the current WordPress site and does not replace its pages or design. Tours carry an explicit `legacy_path` such as `/מסלול-קיים/`; the frontend can map that path to the existing visual template. Import each original URL exactly, then check for collisions before enabling a new frontend route. Once published, the path is locked until the tour is returned to draft for a deliberate URL change. This CPT has no WordPress rewrite rule, so it cannot seize an existing page URL.

Public read endpoints:

- `GET /wp-json/derech/v1/tours` — published, approved tours only. Optional `?path=/.../` selects one legacy path (still returned as an array). Fields: `id`, `title`, `legacy_path`, `excerpt`, `content_html`, `featured_media`, `meeting_point`, `duration_minutes`, `audience`, `status`, `group_terms`.
- `GET /wp-json/derech/v1/occurrences` — published, approved occurrences whose parent tour remains published. Optional `?tour_id=123`. Fields: `id`, `tour_id`, `title`, `starts_at` with offset, `timezone` (`Asia/Jerusalem`), `capacity`, `price` (`amount_minor` in agorot; `currency: ILS`), `booking_url`, `booking_enabled`.

No draft, private, or pending record is returned by these endpoints, even to an authenticated caller. The CPTs are excluded from default WordPress REST routes. Neither endpoint returns author, account, customer, or payment data. Collections cap at 100 items; pagination should be added before exceeding that inventory.

Commercial confirmation is deliberate. Save a tour as a draft with a valid original path; group terms must be confirmed if present. Save an occurrence as a draft with a published parent tour, valid Israel local date/time, capacity, price and an explicit confirmation checkbox, then publish on the next save. Missing or invalid required data sends an already published item back to draft. Local times in the skipped spring hour or repeated autumn hour are rejected. Prices are entered in shekels with up to two decimal places and stored as integer agorot.

External booking is disabled by default. Configure an **exact**, documented Grow host list in `wp-config.php` only after verifying the official booking hostname for this organization:

```php
define( 'DERECH_GROW_ALLOWED_HOSTS', array() ); // Add only the exact host verified with the provider.
```

The empty list is intentionally deny-all. The validator accepts only HTTPS links to an exact allowlisted host, without credentials, fragment, or non-443 port. If no approved hosts are configured, an entered booking link is rejected and the API exposes `booking_enabled: false`. No payment integration or outbound message is implemented.

Before deployment: run `php -l wp-content/mu-plugins/derech-content.php` in the isolated WordPress PHP runtime, create draft test records in the local admin, verify publish gates and both REST responses while logged out, and inspect the inherited visual template at desktop/mobile sizes. Confirm original paths, media, commercial terms, and Grow hostname with their owners before any migration or public release.
