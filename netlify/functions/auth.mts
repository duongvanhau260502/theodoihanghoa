import type { Context, Config } from "@netlify/functions";

// So khớp mật khẩu với biến môi trường bí mật SITE_PASSWORD (đặt trong
// Netlify dashboard, KHÔNG nằm trong mã nguồn / bundle gửi cho trình
// duyệt) — chỉ trả về true/false cho client, không lộ giá trị thật.
//
// Nếu biến SITE_PASSWORD CHƯA được đặt, tính năng khoá mật khẩu coi như
// TẮT: GET trả required=false (app bỏ qua màn hình mật khẩu), và POST
// luôn cho qua. Muốn bật lại, chỉ cần vào Netlify → Site configuration →
// Environment variables → thêm SITE_PASSWORD, không cần sửa code.

export default async (req: Request, context: Context) => {
  const expected = Netlify.env.get("SITE_PASSWORD") || "";

  if (req.method === "GET") {
    return new Response(JSON.stringify({ required: !!expected }), {
      headers: { "content-type": "application/json" },
    });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: { "content-type": "application/json" } });
  }

  const ok = !expected || body.password === expected;

  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 401,
    headers: { "content-type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/auth",
};
