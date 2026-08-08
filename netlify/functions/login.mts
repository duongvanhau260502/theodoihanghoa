import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { verifyPassword, signToken, jsonResponse } from "./_shared.mts";

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false }, 400);
  }

  const store = getStore("vlink-users");
  const users: any[] = (await store.get("users", { type: "json" })) || [];
  const user = users.find((u) => u.username.toLowerCase() === String(body.username || "").trim().toLowerCase());

  if (!user || !verifyPassword(body.password || "", user.salt, user.hash)) {
    return jsonResponse({ ok: false, error: "Sai tên đăng nhập hoặc mật khẩu" }, 401);
  }

  const token = signToken({ id: user.id, role: user.role, username: user.username, name: user.name });
  return jsonResponse({ ok: true, token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
};

export const config: Config = {
  path: "/api/login",
};
