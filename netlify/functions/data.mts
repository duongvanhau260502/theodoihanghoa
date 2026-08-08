import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Dữ liệu toàn bộ dự án (BoQ, phiếu, NCC, NTP, hoá đơn...) được lưu
// dưới dạng MỘT bản ghi JSON duy nhất trong Netlify Blobs, dùng chung
// cho mọi người truy cập trang (last-write-wins).

const STORE_NAME = "vlink-data";
const KEY = "project";

function checkAuth(req: Request): boolean {
  const expected = Netlify.env.get("SITE_PASSWORD") || "";
  if (!expected) return true; // nếu chưa đặt mật khẩu, không chặn (môi trường dev)
  const provided = req.headers.get("x-site-password") || "";
  return provided === expected;
}

export default async (req: Request, context: Context) => {
  if (!checkAuth(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const store = getStore(STORE_NAME);

  if (req.method === "GET") {
    const value = await store.get(KEY, { type: "json" });
    return new Response(JSON.stringify({ value }), {
      headers: { "content-type": "application/json" },
    });
  }

  if (req.method === "PUT" || req.method === "POST") {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    await store.setJSON(KEY, body);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("Method Not Allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/data",
};
