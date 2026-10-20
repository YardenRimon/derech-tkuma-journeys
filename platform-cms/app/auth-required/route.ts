export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("return_to") ?? "/admin";
  const target = value === "/admin/users" ? "/admin/users" : "/admin";
  return new Response(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>נדרשת התחברות | דרך התקומה</title></head><body><main><h1>נדרשת התחברות מאובטחת</h1><p>הגישה לעריכה דורשת אימות זהות. אם ההתחברות אינה נפתחת, פנה למנהל התשתית.</p><a href="${target}">כניסה לעריכה</a></main></body></html>`, { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
}
