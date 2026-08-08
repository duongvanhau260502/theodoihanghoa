import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { hashPassword, verifyToken, getBearer, cryptoId, jsonResponse } from "./_shared.mts";

const STORE = "vlink-users";
const KEY = "users";

function publicUser(u: any) {
  return { id: u.id, username: u.username, name: u.name, role: u.role };
}

export default async (req: Request) => {
  const store = getStore(STORE);
  const users: any[] = (await store.get(KEY, { type: "json" })) || [];

  if (req.method === "GET") {
    if (users.length === 0) return jsonResponse({ bootstrap: true, users: [] });
    const payload = verifyToken(getBearer(req));
    if (payload && payload.role === "admin") {
      return jsonResponse({ bootstrap: false, users: users.map(publicUser) });
    }
    return jsonResponse({ bootstrap: false }); // chưa đăng nhập admin -> không lộ danh sách
  }

  if (req.method === "POST") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: "Dữ liệu không hợp lệ" }, 400);
    }

    // --- Trường hợp 1: chưa có ai -> tạo tài khoản Quản trị viên đầu tiên, không cần đăng nhập ---
    if (users.length === 0) {
      if (!body.username || !body.password) return jsonResponse({ ok: false, error: "Thiếu tên đăng nhập hoặc mật khẩu" }, 400);
      const { hash, salt } = hashPassword(body.password);
      const user = { id: cryptoId(), username: String(body.username).trim(), name: body.name || body.username, role: "admin", hash, salt };
      users.push(user);
      await store.setJSON(KEY, users);
      return jsonResponse({ ok: true, user: publicUser(user) });
    }

    // --- Trường hợp 2: đã có người -> chỉ Quản trị viên mới được tạo thêm tài khoản ---
    const payload = verifyToken(getBearer(req));
    if (!payload || payload.role !== "admin") return jsonResponse({ ok: false, error: "Không có quyền" }, 401);
    if (!body.username || !body.password) return jsonResponse({ ok: false, error: "Thiếu tên đăng nhập hoặc mật khẩu" }, 400);
    if (users.find((u) => u.username.toLowerCase() === String(body.username).trim().toLowerCase())) {
      return jsonResponse({ ok: false, error: "Tên đăng nhập đã tồn tại" }, 409);
    }
    const { hash, salt } = hashPassword(body.password);
    const user = { id: cryptoId(), username: String(body.username).trim(), name: body.name || body.username, role: body.role || "editor", hash, salt };
    users.push(user);
    await store.setJSON(KEY, users);
    return jsonResponse({ ok: true, user: publicUser(user) });
  }

  if (req.method === "DELETE") {
    const payload = verifyToken(getBearer(req));
    if (!payload || payload.role !== "admin") return jsonResponse({ ok: false, error: "Không có quyền" }, 401);
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const next = users.filter((u) => u.id !== id);
    await store.setJSON(KEY, next);
    return jsonResponse({ ok: true });
  }

  return new Response("Method Not Allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/users",
};
