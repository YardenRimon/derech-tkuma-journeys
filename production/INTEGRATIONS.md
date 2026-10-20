# חוזה חיבורים וקבלת מעבר — 19.10.2026

| תחום | הנכס הקיים / המידע הידוע | בדיקת קבלה הנדרשת |
|---|---|---|
| CMS | רשומות מסלולים ומועדי סיור, עורך Shared platform CMS בעברית | טיוטה אינה פומבית; עריכה ופרסום מעדכנים את העמוד המתאים; נתיב קיים נשמר; השבתת מועד מונעת הרשמה |
| תוכן מסחרי | כל נתוני המקור הנוכחי מאושרים להעתקה לפי הוראת הבעלים; ארבעה סיורים ושישה מועדים יובאו | לשמר תאריכים/מחירים במקור. שדות חסרים אינם מנוחשים; שאלות נפתחות במשימות רזיאל ואינן עוצרות העתקה |
| מייל | החשבון הארגוני derechtkuma@gmail.com זוהה בחלון שהוקצה | לזהות את ספק המשלוח בפועל ואת כתובת הנמען; טופס אחד מגיע, אין כפילות, שגיאה לא מוצגת כהצלחה; אין הסקה ש־Gmail הוא ספק transactional |
| WhatsApp | מספר 972535955166 מופיע בקישור הציבורי המתוקן | פתיחה במובייל/מחשב ליעד המאומת; אירוע קליק נפרד מפנייה; שליחה אוטומטית רק עם נכס API מורשה |
| Grow | ספק נדרש; userId/pageCode ומסלול הסליקה הארגוני לא אומתו | יצירה בשרת בלבד, אימות הודעת שרת מול הספק והתאמת transactionCode+amount+currency, replay פעם אחת; דף תודה/iframe אינו אישור עסקה; ללא חיוב אמיתי |
| GA4 | 505868691; stream G-DV3E8J77EX זוהה במקור | hostname/stream נכונים, תרחישי קליק/פנייה/רכישה בנפרד, no-PII ו־dedupe; בדמו אין משלוח נתוני בדיקה לנכס החי |
| GTM | GTM-5N7NPTL4 זוהה במקור | גישה לחשבון המנהל הנכון, רשימת tags ו־triggers, Preview לפני פרסום, אין טעינה כפולה |
| Pixel | 766863783155971 זוהה במקור; הרשאת ניהול טרם אומתה | לזהות מהמקור/מנהל הנכס, להסדיר Consent, לבדוק Browser/Server dedup אם קיים CAPI |
| SEO | נכס GSC הקיים + מפיק השרת של מערכת השירותים | URL map, redirects, canonical, sitemap; מתאם כתיבה ל־CMS על החדש, תחילה טיוטות וקריאה חוזרת; noindex מוסר רק באתר הציבורי שקיבל קבלה |

CI/CD פעיל באתר הבדיקה ב־Cloudflare: בדיקות וקבלת המקור המדויק קודמות לפריסה באותה ריצת GitHub, עם סביבה מוגנת ובלי מפתח SSH של השרת. ריצות PR אינן פורסות. החוזה העדכני הוא `CLOUDFLARE-CD-CONTRACT.md`; צינור WordPress הישן נשאר מושבת. פריסה לאתר הבדיקה אינה מעבר לדומיין הציבורי.

Grow: [Overview](https://developers.grow.business/reference/regular-payment-overview), [Webhooks](https://developers.grow.business/docs/webhooks). הנכסים והקישורים בטבלה מבוססים על מצב הפרויקט; הגישה והחיבורים שטרם אומתו נשארים שערי ביצוע, לא הושלמו מעצם כתיבת החוזה.


The isolated Cloudflare CMS supersedes the stopped WordPress experiment and the old Sites deployment path. Shared Google identity is backed by Supabase with active CMS grants; the explicitly approved pilot does not require MFA. Sites and legacy Cloudflare Access descriptions are historical. Do not activate the old SSH/WordPress staging workflow.


## Current source integration capture — 19 October 2026

Five source Elementor form identities, six WooCommerce product/date/price mappings and sixteen quote calculation rows are recorded in `audit/source-integrations-2026-10-19.json`. Grow uses the production SDK and receives its checkout token from the server `wc-ajax=checkout` response. Public HTML does not establish merchant credentials, validated webhooks or mail destinations. No source checkout, payment, lead submission or provider setting changed. WordPress currently exposes existing Grow Pay and Easy WP SMTP settings and Elementor submissions. Inspect their actual configuration before replacing these business flows. The pages-only WXR download is truncated; it is retained privately as partial evidence and is not a full backup. Never publish raw export or private recipients in GitHub.

## 20 October readiness evidence and remaining activation gates

- Complete app code rollback was exercised in isolated loopback Workerd using the current and previous pinned Git builds and one restored persistent D1/R2 pair. All 37 public routes, 982 source assets, six protected owner screens, owner identity pins, draft/history rows and restored media survived current → previous → current. This is isolated acceptance, not a live provider rollback. See `platform-cms/CODE-ROLLBACK-CONTRACT.md`.
- The SEO reader now accepts the actual four-tour/six-occurrence projection, retains unknown source fields and source paths, and produces sixteen internal proposals. The exact review host is staging-only and cannot pass a public-mode flag. Draft writes, task execution and publication remain separate gates.
- The review visitor module normalizes the three exact source phone variants to the approved WhatsApp number, preserving CTA text and query bytes. It dispatches nothing and cannot load providers. A production consent UI, exact existing-container review and dispatcher remain required.
- The prepared native contact client is limited to the two verified source contact forms and the existing server JSON/idempotency boundary. Keep intake disabled on review and before source routing, abuse, retention and end-to-end delivery acceptance. Storage is not delivery. Footer, rating and quote contracts remain pending.
- The independent heartbeat receiver and producer are separate from the existing sender. An outside evaluator, durable incident ledger, exact shared calendar and proven private notification during a VPS outage remain an infrastructure release gate. A heartbeat is not proof that outage alerts reach the owner.

Do not turn missing implementation into a client access request. Client tasks remain full source backup/restore, domain/DNS access and genuinely missing Grow/mail/Make/measurement configuration. Account sender-domain selection for the general platform was deferred by the owner and is separate from the client-domain cutover.
