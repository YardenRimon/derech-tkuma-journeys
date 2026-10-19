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

צינור GitHub בתיקיית github-workflows מוכן לבדיקה בענף מבודד; הצבתו תחת `.github/workflows/` במאגר אינה מקימה אוטומטית secrets/environments/branch protection. אין לסמן CI/CD כפעיל לפני run מוצלח והפעלה אמיתית. חשבון SSH של GitHub יהיה תחום לשירות האתר, ללא root או גישה למסדי הבוטים. אין להעתיק ל־GitHub את מפתח ה־SSH הראשי הקיים.

Grow: [Overview](https://developers.grow.business/reference/regular-payment-overview), [Webhooks](https://developers.grow.business/docs/webhooks). הנכסים והקישורים בטבלה מבוססים על מצב הפרויקט; הגישה והחיבורים שטרם אומתו נשארים שערי ביצוע, לא הושלמו מעצם כתיבת החוזה.


CMS target supersedes the stopped WordPress experiment. Reuse platform-cms and existing Sites identity/auth. CI is not CD: Sites version publication has no durable GitHub merge hook yet, including in Gvanim. Do not activate the old SSH/WordPress staging workflow.


## Current source integration capture — 19 October 2026

Five source Elementor form identities, six WooCommerce product/date/price mappings and sixteen quote calculation rows are recorded in `audit/source-integrations-2026-10-19.json`. Grow uses the production SDK and receives its checkout token from the server `wc-ajax=checkout` response. Public HTML does not establish merchant credentials, validated webhooks or mail destinations. No source checkout, payment, lead submission or provider setting changed. WordPress currently exposes existing Grow Pay and Easy WP SMTP settings and Elementor submissions. Inspect their actual configuration before replacing these business flows. The pages-only WXR download is truncated; it is retained privately as partial evidence and is not a full backup. Never publish raw export or private recipients in GitHub.
