import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  LayoutDashboard, ClipboardList, Truck, Inbox, CheckSquare, Boxes,
  Users, Building2, Settings, Plus, Trash2, Upload, Download,
  AlertTriangle, CheckCircle2, Clock, X, ChevronDown, Search, RefreshCw,
  Printer, LogOut, ShieldCheck, Receipt, Lock, Eye, PencilLine
} from "lucide-react";

/* ---------- roles & permissions ---------- */
const ROLES = {
  admin: { label: "Quản trị viên", icon: ShieldCheck, color: "#2856C7" },
  editor: { label: "Biên tập", icon: PencilLine, color: "#1E8449" },
  viewer: { label: "Chỉ xem", icon: Eye, color: "#8A8F98" },
};

/* ============================================================
   VLINK — Hệ thống Quản lý Vật tư Thi công
   Lõi dữ liệu: BoQItem là trục trung tâm. Order/Receipt/Workdone
   là các giao dịch cộng dồn (Shop/Order/Receipt) hoặc ghi đè
   (Workdone/IPC) vào trục đó. Bảng "Tổng hợp" luôn được TÍNH RA,
   không nhập tay.
   ============================================================ */

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "boq", label: "BoQ & Longlead", icon: ClipboardList },
  { id: "tonghop", label: "Tổng hợp", icon: Boxes },
  { id: "capnhat", label: "Cập nhật", icon: Upload },
  { id: "choxacnhan", label: "Chờ xác nhận", icon: CheckSquare },
  { id: "ncc", label: "Nhà cung cấp", icon: Truck },
  { id: "ntp", label: "Nhà thầu phụ", icon: Users },
  { id: "settings", label: "Dữ liệu & Cài đặt", icon: Settings },
];

const ENTRY_TYPES = {
  shop: { label: "Khối lượng Shop", mode: "sum", color: "#7C6FDB" },
  order: { label: "Đặt hàng (PO)", mode: "sum", color: "#2E7CD6" },
  receipt: { label: "Nhận hàng", mode: "sum", color: "#1E9E6B" },
  workdone: { label: "Workdone / IPC", mode: "override", color: "#D97706" },
};

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const demoData = () => ({
  meta: { projectName: "Dự án DEMO — Cấp thoát nước cơ điện", createdAt: Date.now() },
  suppliers: [
    { id: uid(), name: "CHÂU ÂU XANH", leadTimeDays: 14, scope: "UPVC, PPR, HDPE và phụ kiện" },
  ],
  subcontractors: [
    { id: uid(), name: "Hymep", shortName: "Hymep" },
  ],
  boqItems: [
    { id: uid(), code: "I", desc: "Ống nhựa PPR DN20 PN16", model: "Ống nhựa PPR DN20 PN16", unit: "m", qty: 7570, supplierId: null, category: "PPR" },
    { id: uid(), code: "II", desc: "Ống nhựa PPR DN25 PN16", model: "Ống nhựa PPR DN25 PN16", unit: "m", qty: 3373, supplierId: null, category: "PPR" },
    { id: uid(), code: "III", desc: "Ống nhựa PPR DN32 PN16", model: "Ống nhựa PPR DN32 PN16", unit: "m", qty: 2345, supplierId: null, category: "PPR" },
    { id: uid(), code: "IV", desc: "Ống nhựa PPR DN40 PN16", model: "Ống nhựa PPR DN40 PN16", unit: "m", qty: 1574, supplierId: null, category: "PPR" },
    { id: uid(), code: "V", desc: "Ống nhựa PPR DN50 PN16", model: "Ống nhựa PPR DN50 PN16", unit: "m", qty: 1956, supplierId: null, category: "PPR" },
    { id: uid(), code: "VIII", desc: "Ống nhựa uPVC DN200 PN8", model: "Ống nhựa uPVC DN200 PN8", unit: "m", qty: 928, supplierId: null, category: "uPVC" },
    { id: uid(), code: "XIII", desc: "Ống nhựa uPVC DN250 PN8", model: "Ống nhựa uPVC DN250 PN8", unit: "m", qty: 517.5, supplierId: null, category: "uPVC" },
  ],
  entries: [],
  pending: [],
  invoices: [],
});

/* ---------- text / matching helpers ---------- */
function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function tokenScore(a, b) {
  const ta = new Set(normalize(a).split(" ").filter(Boolean));
  const tb = new Set(normalize(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter++; });
  return inter / new Set([...ta, ...tb]).size;
}
function bestMatch(rawDesc, rawModel, boqItems) {
  let best = null, bestScore = -1;
  for (const item of boqItems) {
    const s = tokenScore(`${rawDesc} ${rawModel}`, `${item.desc} ${item.model}`);
    if (s > bestScore) { bestScore = s; best = item; }
  }
  return { item: best, confidence: Math.round(bestScore * 100) };
}

/* ---------- parsing pasted / raw rows ---------- */
function parseRawLines(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t|,|;/).map((p) => p.trim()).filter((p) => p !== "");
      let desc = parts[0] || "";
      let qty = 0;
      for (let i = parts.length - 1; i >= 1; i--) {
        const n = Number(parts[i].replace(/[.](?=\d{3}(\D|$))/g, "").replace(",", "."));
        if (!isNaN(n) && parts[i] !== "") { qty = n; break; }
      }
      const model = parts.length > 2 ? parts[1] : desc;
      return { desc, model, qty };
    });
}

/* ---------- aggregation: BoQItem -> computed status ---------- */
function computeStatus(boqItem, entries) {
  const own = entries.filter((e) => e.boqItemId === boqItem.id);
  const sumBy = (type) => own.filter((e) => e.type === type).reduce((s, e) => s + e.qty, 0);
  const ordered = sumBy("order");
  const received = sumBy("receipt");
  const shop = sumBy("shop");
  const workdoneEntries = own.filter((e) => e.type === "workdone").sort((a, b) => a.date.localeCompare(b.date));
  const workdone = workdoneEntries.length ? workdoneEntries[workdoneEntries.length - 1].qty : 0;
  const inventory = received - workdone;

  const alerts = [];
  if (received > ordered + 1e-6) alerts.push({ level: "red", text: `Về > Đặt (+${(received - ordered).toLocaleString("vi-VN")})` });
  if (received > 0 && ordered === 0) alerts.push({ level: "red", text: "Về hàng chưa có PO" });
  if (workdone > received + 1e-6) alerts.push({ level: "amber", text: "Nghiệm thu > Tồn kho" });
  if (boqItem.qty > 0 && ordered === 0) alerts.push({ level: "gray", text: "Chưa đặt hàng" });
  if (ordered > 0 && received === 0) alerts.push({ level: "amber", text: "Chưa về hàng" });

  return {
    ordered, received, shop, workdone, inventory, alerts,
    pctOrder: boqItem.qty ? (ordered / boqItem.qty) * 100 : 0,
    pctReceived: ordered ? (received / ordered) * 100 : 0,
  };
}

/* ---------- persistence ----------
   Dữ liệu được lưu trên server (Netlify Function + Netlify Blobs) qua
   API /api/data, dùng CHUNG cho mọi người truy cập trang — không phải
   lưu riêng theo từng trình duyệt. Ghi có debounce 400ms; đồng thời
   trang tự làm mới dữ liệu mỗi 8s để mọi người thấy cập nhật của nhau. */
const API_URL = "/api/data";

function useProjectData(sitePassword) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const saveTimer = useRef(null);
  const skipNextPoll = useRef(false);

  const authHeaders = sitePassword ? { "x-site-password": sitePassword } : {};

  const load = useCallback(async (isInitial) => {
    try {
      const res = await fetch(API_URL, { headers: authHeaders });
      if (!res.ok) throw new Error("Lỗi tải dữ liệu");
      const json = await res.json();
      if (json.value) {
        setData(json.value);
      } else if (isInitial) {
        setData(demoData());
      }
      setError(null);
    } catch (e) {
      if (isInitial) setData(demoData());
      setError("Không kết nối được máy chủ dữ liệu — đang dùng dữ liệu tạm trong phiên này.");
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [sitePassword]);

  useEffect(() => {
    load(true);
    const interval = setInterval(() => {
      if (skipNextPoll.current) { skipNextPoll.current = false; return; }
      load(false);
    }, 8000);
    return () => clearInterval(interval);
  }, [load]);

  const persist = useCallback((next) => {
    setData(next);
    skipNextPoll.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(API_URL, {
          method: "PUT",
          headers: { "content-type": "application/json", ...authHeaders },
          body: JSON.stringify(next),
        });
        if (!res.ok) throw new Error();
        setError(null);
      } catch {
        setError("Không lưu được lên máy chủ (sẽ thử lại ở lần thay đổi tiếp theo).");
      }
    }, 400);
  }, []);

  return { data, setData: persist, loading, error };
}

/* ---------- small UI atoms ---------- */
const Badge = ({ level, children }) => {
  const map = {
    red: { bg: "#FDECEC", fg: "#C0392B", bd: "#F5B7B1" },
    amber: { bg: "#FEF6E7", fg: "#B7791F", bd: "#F6D98E" },
    green: { bg: "#E8F6EE", fg: "#1E8449", bd: "#A9DFC0" },
    gray: { bg: "#F1F2F4", fg: "#5B6169", bd: "#D8DBE0" },
    blue: { bg: "#EAF1FC", fg: "#2E5FA3", bd: "#B9D2F0" },
  };
  const c = map[level] || map.gray;
  return (
    <span style={{ background: c.bg, color: c.fg, border: `1px solid ${c.bd}` }}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap">
      {children}
    </span>
  );
};

const Card = ({ title, value, sub, accent }) => (
  <div className="bg-white rounded-xl border border-[#E4E6EA] p-4 flex flex-col gap-1 min-w-[150px]">
    <div className="text-[11px] uppercase tracking-wide text-[#8A8F98] font-semibold">{title}</div>
    <div className="text-2xl font-bold" style={{ color: accent || "#1D2129" }}>{value}</div>
    {sub && <div className="text-[12px] text-[#8A8F98]">{sub}</div>}
  </div>
);

const Btn = ({ children, onClick, variant = "primary", size = "md", disabled, title }) => {
  const base = "inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const sizes = { sm: "px-2.5 py-1 text-[12px]", md: "px-3.5 py-2 text-[13px]" };
  const variants = {
    primary: "bg-[#2856C7] text-white hover:bg-[#1F45A6]",
    ghost: "bg-transparent text-[#4A5058] hover:bg-[#F1F2F4]",
    danger: "bg-[#FDECEC] text-[#C0392B] hover:bg-[#FBD9D6]",
    outline: "bg-white text-[#2856C7] border border-[#C9D6EF] hover:bg-[#F3F6FD]",
    success: "bg-[#1E8449] text-white hover:bg-[#176B3A]",
  };
  return (
    <button title={title} disabled={disabled} onClick={onClick} className={`${base} ${sizes[size]} ${variants[variant]}`}>
      {children}
    </button>
  );
};

const Field = ({ label, children }) => (
  <label className="flex flex-col gap-1 text-[12px] text-[#5B6169] font-medium">
    {label}
    {children}
  </label>
);

const inputCls = "border border-[#DADDE2] rounded-lg px-2.5 py-1.5 text-[13px] text-[#1D2129] outline-none focus:border-[#2856C7] focus:ring-2 focus:ring-[#2856C7]/15 bg-white";

const PermissionNotice = () => (
  <div className="flex items-center gap-2 bg-[#FEF6E7] border border-[#F6D98E] text-[#B7791F] text-[12px] rounded-lg px-3 py-2">
    <Lock size={13} /> Tài khoản "Chỉ xem" — bạn có thể xem và xuất báo cáo nhưng không thể thêm/sửa/xoá dữ liệu.
  </div>
);

/* ---------- print / PDF export ----------
   In toàn bộ trang bị ẩn khi in, chỉ #print-area được hiện ra
   (đổ nội dung động qua props) — người dùng bấm "Lưu dưới dạng PDF"
   trong hộp thoại in của trình duyệt để xuất file PDF thật. */
function PrintArea({ report }) {
  return (
    <div id="print-area" style={{ display: "none" }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { display: block !important; position: absolute; left: 0; top: 0; width: 100%; padding: 20px; }
          #print-area table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
          #print-area th, #print-area td { border-bottom: 1px solid #ccc; padding: 4px 6px; text-align: left; }
          #print-area th { background: #f2f2f2; }
        }
      `}</style>
      {report && (
        <>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{report.title}</div>
          {report.subtitle && <div style={{ fontSize: 11, color: "#555", marginBottom: 10 }}>{report.subtitle}</div>}
          <table>
            <thead><tr>{report.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
            <tbody>
              {report.rows.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/* ============================================================ */

function Workspace({ session, sitePassword, onLogout }) {
  const { data, setData, loading, error } = useProjectData(sitePassword);
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [printReport, setPrintReport] = useState(null);
  const role = session.role;
  const canEdit = role !== "viewer";
  const isAdmin = role === "admin";

  const showToast = (msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2600);
  };

  const triggerPrint = (report) => {
    setPrintReport(report);
    setTimeout(() => window.print(), 120);
  };

  if (loading || !data) {
    return (
      <div className="h-full min-h-[500px] flex items-center justify-center text-[#8A8F98] text-sm gap-2">
        <RefreshCw size={16} className="animate-spin" /> Đang tải dữ liệu dự án…
      </div>
    );
  }

  const statusByItem = useMemo(() => {
    const m = new Map();
    data.boqItems.forEach((it) => m.set(it.id, computeStatus(it, data.entries)));
    return m;
  }, [data.boqItems, data.entries]);

  const allAlerts = useMemo(() => {
    const list = [];
    data.boqItems.forEach((it) => {
      const st = statusByItem.get(it.id);
      st.alerts.forEach((a) => list.push({ item: it, ...a }));
    });
    return list;
  }, [data.boqItems, statusByItem]);

  return (
    <div className="w-full h-full min-h-[600px] bg-[#F5F6F8] text-[#1D2129] flex flex-col font-sans" style={{ fontFamily: "Inter, ui-sans-serif, system-ui" }}>
      {/* Header */}
      <div className="bg-white border-b border-[#E4E6EA] px-5 py-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#2856C7] text-white flex items-center justify-center font-black text-sm">VL</div>
          <div>
            <div className="font-bold text-[15px] leading-tight">VLINK — Quản lý Vật tư Thi công</div>
            <div className="text-[11px] text-[#8A8F98] leading-tight">{data.meta.projectName}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {error && <span className="text-[11px] text-[#C0392B]">{error}</span>}
          <Badge level="blue">Dữ liệu dùng chung (server)</Badge>
          <div className="flex items-center gap-1.5 pl-3 border-l border-[#E4E6EA]">
            <RoleIcon role={role} />
            <div className="leading-tight">
              <div className="text-[12.5px] font-semibold">{session.name}</div>
              <div className="text-[10.5px] text-[#8A8F98]">{ROLES[role].label}</div>
            </div>
            <button title="Đăng xuất" onClick={onLogout} className="ml-2 text-[#8A8F98] hover:text-[#C0392B] hover:bg-[#FDECEC] p-1.5 rounded-lg">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-[#E4E6EA] px-5 flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium border-b-2 whitespace-nowrap transition-colors ${active ? "border-[#2856C7] text-[#2856C7]" : "border-transparent text-[#5B6169] hover:text-[#1D2129]"}`}>
              <Icon size={15} /> {t.label}
              {t.id === "choxacnhan" && data.pending.length > 0 && (
                <span className="ml-1 bg-[#C0392B] text-white text-[10px] rounded-full px-1.5 py-0.5">{data.pending.length}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-5">
        {tab === "dashboard" && <Dashboard data={data} statusByItem={statusByItem} allAlerts={allAlerts} />}
        {tab === "boq" && <BoqTab data={data} setData={setData} showToast={showToast} canEdit={canEdit} />}
        {tab === "tonghop" && <TongHopTab data={data} statusByItem={statusByItem} onPrint={triggerPrint} projectName={data.meta.projectName} />}
        {tab === "capnhat" && <CapNhatTab data={data} setData={setData} showToast={showToast} canEdit={canEdit} />}
        {tab === "choxacnhan" && <ChoXacNhanTab data={data} setData={setData} showToast={showToast} canEdit={canEdit} />}
        {tab === "ncc" && <NccTab data={data} setData={setData} statusByItem={statusByItem} showToast={showToast} canEdit={canEdit} onPrint={triggerPrint} projectName={data.meta.projectName} />}
        {tab === "ntp" && <NtpTab data={data} setData={setData} showToast={showToast} canEdit={canEdit} />}
        {tab === "settings" && <SettingsTab data={data} setData={setData} showToast={showToast} isAdmin={isAdmin} />}
      </div>

      {toast && (
        <div className={`fixed bottom-5 right-5 px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium text-white ${toast.kind === "ok" ? "bg-[#1E8449]" : "bg-[#C0392B]"}`}>
          {toast.msg}
        </div>
      )}

      <PrintArea report={printReport} />
    </div>
  );
}

function RoleIcon({ role }) {
  const R = ROLES[role] || ROLES.viewer;
  const Icon = R.icon;
  return <span style={{ color: R.color }}><Icon size={16} /></span>;
}

/* ============================================================
   ĐĂNG NHẬP / PHÂN QUYỀN
   ============================================================ */
function LoginGate() {
  const [session, setSession] = useState(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("editor");

  const [pwRequired, setPwRequired] = useState(null); // null = đang kiểm tra, true/false = đã biết
  const [sitePassword, setSitePassword] = useState(null); // mật khẩu ĐÃ xác thực thành công
  const [pwInput, setPwInput] = useState("");
  const [pwChecking, setPwChecking] = useState(false);
  const [pwError, setPwError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth");
        const json = await res.json();
        setPwRequired(!!json.required);
      } catch {
        setPwRequired(false); // không kết nối được server -> không chặn, coi như chưa bật mật khẩu
      }
    })();
  }, []);

  if (session) return <Workspace session={session} sitePassword={sitePassword} onLogout={() => setSession(null)} />;

  const verifyPassword = async () => {
    if (!pwInput) return;
    setPwChecking(true);
    setPwError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pwInput }),
      });
      const json = await res.json();
      if (json.ok) {
        setSitePassword(pwInput);
      } else {
        setPwError("Sai mật khẩu, thử lại.");
      }
    } catch {
      setPwError("Không kết nối được máy chủ để kiểm tra mật khẩu.");
    } finally {
      setPwChecking(false);
    }
  };

  // BƯỚC 1 — cổng mật khẩu chung của cả trang (chỉ hiện nếu server đã bật SITE_PASSWORD)
  if (pwRequired === null) {
    return (
      <div className="w-full h-full min-h-[600px] bg-[#F5F6F8] flex items-center justify-center p-6 text-[#8A8F98] text-[13px] gap-2" style={{ fontFamily: "Inter, ui-sans-serif, system-ui" }}>
        <RefreshCw size={16} className="animate-spin" /> Đang tải…
      </div>
    );
  }

  if (pwRequired && !sitePassword) {
    return (
      <div className="w-full h-full min-h-[600px] bg-[#F5F6F8] flex items-center justify-center p-6" style={{ fontFamily: "Inter, ui-sans-serif, system-ui" }}>
        <div className="bg-white rounded-2xl border border-[#E4E6EA] shadow-sm w-full max-w-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-9 h-9 rounded-lg bg-[#2856C7] text-white flex items-center justify-center font-black text-sm">VL</div>
            <div className="font-bold text-[15px]">VLINK</div>
          </div>
          <div className="text-[12.5px] text-[#8A8F98] mb-5">Trang này yêu cầu mật khẩu truy cập.</div>
          <div className="flex flex-col gap-3">
            <Field label="Mật khẩu truy cập">
              <input type="password" autoFocus className={inputCls} value={pwInput}
                onChange={(e) => { setPwInput(e.target.value); setPwError(""); }}
                onKeyDown={(e) => e.key === "Enter" && verifyPassword()} />
            </Field>
            {pwError && <div className="text-[12px] text-[#C0392B] flex items-center gap-1.5"><Lock size={12} /> {pwError}</div>}
            <Btn onClick={verifyPassword} disabled={!pwInput || pwChecking}>{pwChecking ? "Đang kiểm tra…" : "Tiếp tục"}</Btn>
          </div>
        </div>
      </div>
    );
  }

  // BƯỚC 2 — chọn tên hiển thị + vai trò
  return (
    <div className="w-full h-full min-h-[600px] bg-[#F5F6F8] flex items-center justify-center p-6" style={{ fontFamily: "Inter, ui-sans-serif, system-ui" }}>
      <div className="bg-white rounded-2xl border border-[#E4E6EA] shadow-sm w-full max-w-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-9 h-9 rounded-lg bg-[#2856C7] text-white flex items-center justify-center font-black text-sm">VL</div>
          <div className="font-bold text-[15px]">VLINK</div>
        </div>
        <div className="text-[12.5px] text-[#8A8F98] mb-5">Quản lý Vật tư Thi công — đăng nhập theo vai trò</div>

        <div className="flex flex-col gap-3">
          <Field label="Tên hiển thị">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Nguyễn Văn A" />
          </Field>
          <Field label="Vai trò">
            <div className="flex flex-col gap-2">
              {Object.entries(ROLES).map(([key, r]) => {
                const Icon = r.icon;
                const active = role === key;
                return (
                  <button key={key} onClick={() => setRole(key)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-[13px] transition-colors ${active ? "border-[#2856C7] bg-[#EAF1FC]" : "border-[#DADDE2] hover:bg-[#F8F9FB]"}`}>
                    <Icon size={15} style={{ color: r.color }} />
                    <span className="font-medium">{r.label}</span>
                  </button>
                );
              })}
            </div>
          </Field>
          <div className="text-[11px] text-[#8A8F98] flex items-start gap-1.5 mt-1">
            <Lock size={12} className="mt-0.5 shrink-0" />
            Quản trị viên: toàn quyền · Biên tập: thêm/sửa/duyệt dữ liệu · Chỉ xem: không chỉnh sửa được.
          </div>
          <Btn onClick={() => name.trim() && setSession({ name: name.trim(), role })} disabled={!name.trim()}>
            Vào hệ thống
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function Dashboard({ data, statusByItem, allAlerts }) {
  const n = data.boqItems.length;
  const avg = (fn) => (n ? data.boqItems.reduce((s, it) => s + fn(statusByItem.get(it.id)), 0) / n : 0);
  const pctOrder = avg((s) => Math.min(s.pctOrder, 100));
  const pctReceived = avg((s) => Math.min(s.pctReceived, 100));
  const openAlerts = allAlerts.filter((a) => a.level === "red" || a.level === "amber");
  const inventoryValue = data.boqItems.reduce((s, it) => s + Math.max(statusByItem.get(it.id).inventory, 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-3">
        <Card title="Đầu mục BoQ" value={n} />
        <Card title="% Đặt hàng TB" value={`${pctOrder.toFixed(0)}%`} accent="#2856C7" />
        <Card title="% Nhận hàng TB" value={`${pctReceived.toFixed(0)}%`} accent="#1E8449" />
        <Card title="Cảnh báo đang mở" value={openAlerts.length} accent={openAlerts.length ? "#C0392B" : "#1E8449"} />
        <Card title="Tồn kho (tổng ĐVT gộp)" value={inventoryValue.toLocaleString("vi-VN")} />
      </div>

      <div className="bg-white rounded-xl border border-[#E4E6EA]">
        <div className="px-4 py-3 border-b border-[#E4E6EA] font-semibold text-[13px] flex items-center gap-2">
          <AlertTriangle size={15} className="text-[#C0392B]" /> Cảnh báo cần xử lý
        </div>
        {openAlerts.length === 0 ? (
          <div className="p-6 text-center text-[13px] text-[#8A8F98]">Không có cảnh báo nào — mọi thứ đang khớp.</div>
        ) : (
          <div className="divide-y divide-[#F1F2F4] max-h-[360px] overflow-auto">
            {openAlerts.map((a, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center justify-between text-[13px]">
                <div>
                  <span className="font-medium">{a.item.desc}</span>
                  <span className="text-[#8A8F98]"> · {a.item.model}</span>
                </div>
                <Badge level={a.level}>{a.text}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-[#E4E6EA] p-4">
          <div className="font-semibold text-[13px] mb-2">Nhà cung cấp</div>
          <div className="text-[13px] text-[#5B6169]">{data.suppliers.length} nhà cung cấp đang quản lý</div>
        </div>
        <div className="bg-white rounded-xl border border-[#E4E6EA] p-4">
          <div className="font-semibold text-[13px] mb-2">Nhà thầu phụ</div>
          <div className="text-[13px] text-[#5B6169]">{data.subcontractors.length} nhà thầu phụ đang quản lý</div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   BOQ & LONGLEAD
   ============================================================ */
function BoqTab({ data, setData, showToast, canEdit }) {
  const [form, setForm] = useState({ code: "", desc: "", model: "", unit: "m", qty: "", supplierId: "", category: "" });
  const [pasteText, setPasteText] = useState("");

  const addItem = () => {
    if (!form.desc || !form.qty) { showToast("Cần nhập mô tả và khối lượng", "err"); return; }
    const item = { id: uid(), code: form.code, desc: form.desc, model: form.model || form.desc, unit: form.unit, qty: Number(form.qty), supplierId: form.supplierId || null, category: form.category };
    setData({ ...data, boqItems: [...data.boqItems, item] });
    setForm({ code: "", desc: "", model: "", unit: "m", qty: "", supplierId: "", category: "" });
    showToast("Đã thêm đầu mục BoQ");
  };

  const bulkImport = () => {
    const rows = parseRawLines(pasteText);
    if (!rows.length) { showToast("Không có dữ liệu để nạp", "err"); return; }
    const items = rows.map((r) => ({ id: uid(), code: "", desc: r.desc, model: r.model, unit: "m", qty: r.qty, supplierId: null, category: "" }));
    setData({ ...data, boqItems: [...data.boqItems, ...items] });
    setPasteText("");
    showToast(`Đã nạp ${items.length} đầu mục từ dữ liệu dán`);
  };

  const removeItem = (id) => setData({ ...data, boqItems: data.boqItems.filter((i) => i.id !== id) });

  const updateSupplierLead = (id, val) => {
    setData({ ...data, suppliers: data.suppliers.map((s) => s.id === id ? { ...s, leadTimeDays: Number(val) } : s) });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-white rounded-xl border border-[#E4E6EA] p-4">
        <div className="font-semibold text-[13px] mb-3">Thêm đầu mục BoQ thủ công</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Số TT / Mã"><input className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label="Mô tả *"><input className={inputCls} value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} /></Field>
          <Field label="Model"><input className={inputCls} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></Field>
          <Field label="ĐVT"><input className={inputCls} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field>
          <Field label="KL BoQ *"><input type="number" className={inputCls} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></Field>
          <Field label="Nhà cung cấp">
            <select className={inputCls} value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
              <option value="">— chọn —</option>
              {data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Nhóm vật tư"><input className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
          <div className="flex items-end"><Btn onClick={addItem} disabled={!canEdit}><Plus size={14} /> Thêm đầu mục</Btn></div>
        </div>
      </div>

      {!canEdit && <PermissionNotice />}

      <div className="bg-white rounded-xl border border-[#E4E6EA] p-4">
        <div className="font-semibold text-[13px] mb-1">Nạp nhanh nhiều dòng (dán từ Excel)</div>
        <div className="text-[12px] text-[#8A8F98] mb-2">Mỗi dòng: Mô tả [Tab] Model [Tab] Khối lượng — model có thể bỏ trống.</div>
        <textarea className={`${inputCls} w-full h-24 font-mono text-[12px]`} placeholder={"Ống nhựa uPVC DN90 PN8\\tỐng nhựa uPVC DN90 PN8\\t2456\nỐng nhựa uPVC DN110 PN8\\t\\t6880.5"} value={pasteText} onChange={(e) => setPasteText(e.target.value)} disabled={!canEdit} />
        <div className="mt-2"><Btn onClick={bulkImport} variant="outline" disabled={!canEdit}><Upload size={14} /> Nạp vào BoQ</Btn></div>
      </div>

      <div className="bg-white rounded-xl border border-[#E4E6EA]">
        <div className="px-4 py-3 border-b border-[#E4E6EA] font-semibold text-[13px]">Danh mục BoQ ({data.boqItems.length})</div>
        <div className="overflow-auto max-h-[420px]">
          <table className="w-full text-[12.5px]">
            <thead className="bg-[#F8F9FB] text-[#5B6169] sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Mã</th>
                <th className="text-left px-3 py-2 font-medium">Mô tả</th>
                <th className="text-left px-3 py-2 font-medium">Model</th>
                <th className="text-left px-3 py-2 font-medium">ĐVT</th>
                <th className="text-right px-3 py-2 font-medium">KL BoQ</th>
                <th className="text-left px-3 py-2 font-medium">NCC</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.boqItems.map((it) => (
                <tr key={it.id} className="border-t border-[#F1F2F4] hover:bg-[#FAFBFC]">
                  <td className="px-3 py-2 text-[#8A8F98]">{it.code}</td>
                  <td className="px-3 py-2 font-medium">{it.desc}</td>
                  <td className="px-3 py-2 text-[#5B6169]">{it.model}</td>
                  <td className="px-3 py-2">{it.unit}</td>
                  <td className="px-3 py-2 text-right">{it.qty.toLocaleString("vi-VN")}</td>
                  <td className="px-3 py-2 text-[#5B6169]">{data.suppliers.find((s) => s.id === it.supplierId)?.name || "—"}</td>
                  <td className="px-3 py-2 text-right">{canEdit && <button onClick={() => removeItem(it.id)} className="text-[#C0392B] hover:bg-[#FDECEC] p-1 rounded"><Trash2 size={13} /></button>}</td>
                </tr>
              ))}
              {data.boqItems.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-[#8A8F98]">Chưa có đầu mục BoQ</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#E4E6EA] p-4">
        <div className="font-semibold text-[13px] mb-3">Longlead theo nhà cung cấp</div>
        <table className="w-full text-[12.5px]">
          <thead className="text-[#5B6169]"><tr><th className="text-left px-2 py-1.5 font-medium">Nhà cung cấp</th><th className="text-left px-2 py-1.5 font-medium">Phạm vi</th><th className="text-left px-2 py-1.5 font-medium">Longlead (ngày)</th></tr></thead>
          <tbody>
            {data.suppliers.map((s) => (
              <tr key={s.id} className="border-t border-[#F1F2F4]">
                <td className="px-2 py-1.5 font-medium">{s.name}</td>
                <td className="px-2 py-1.5 text-[#5B6169]">{s.scope}</td>
                <td className="px-2 py-1.5"><input type="number" className={`${inputCls} w-24`} value={s.leadTimeDays} onChange={(e) => updateSupplierLead(s.id, e.target.value)} disabled={!canEdit} /></td>
              </tr>
            ))}
            {data.suppliers.length === 0 && <tr><td colSpan={3} className="text-center py-4 text-[#8A8F98]">Chưa có NCC — thêm ở tab "Nhà cung cấp"</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================
   TỔNG HỢP
   ============================================================ */
function TongHopTab({ data, statusByItem, onPrint, projectName }) {
  const [q, setQ] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const rows = data.boqItems.filter((it) => {
    if (supplierFilter && it.supplierId !== supplierFilter) return false;
    if (q && !normalize(it.desc + " " + it.model).includes(normalize(q))) return false;
    return true;
  });

  const exportPdf = () => {
    const columns = ["Mô tả", "Model", "ĐVT", "KL BoQ", "Đặt hàng", "% Đặt", "Nhận hàng", "% Về/Đặt", "Workdone", "Tồn kho", "Cảnh báo"];
    const printRows = rows.map((it) => {
      const s = statusByItem.get(it.id);
      return [
        it.desc, it.model, it.unit, it.qty.toLocaleString("vi-VN"),
        s.ordered.toLocaleString("vi-VN"), `${s.pctOrder.toFixed(0)}%`,
        s.received.toLocaleString("vi-VN"), `${s.pctReceived.toFixed(0)}%`,
        s.workdone.toLocaleString("vi-VN"), s.inventory.toLocaleString("vi-VN"),
        s.alerts.map((a) => a.text).join("; ") || "OK",
      ];
    });
    onPrint({
      title: "Báo cáo Tổng hợp Vật tư",
      subtitle: `${projectName} — xuất ngày ${new Date().toLocaleDateString("vi-VN")}`,
      columns, rows: printRows,
    });
  };

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const sheetRows = rows.map((it) => {
      const s = statusByItem.get(it.id);
      return {
        "Mã": it.code, "Mô tả": it.desc, "Model": it.model, "ĐVT": it.unit,
        "KL BoQ": it.qty, "Đặt hàng": s.ordered, "% Đặt": Math.round(s.pctOrder) + "%",
        "Nhận hàng": s.received, "% Về/Đặt": Math.round(s.pctReceived) + "%",
        "Workdone": s.workdone, "Tồn kho": s.inventory,
        "Cảnh báo": s.alerts.map((a) => a.text).join("; "),
      };
    });
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "TongHop");
    XLSX.writeFile(wb, "BaoCao_TongHop_VatTu.xlsx");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-[#8A8F98]" />
          <input className={`${inputCls} pl-8 w-64`} placeholder="Tìm mô tả / model…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={inputCls} value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
          <option value="">Tất cả NCC</option>
          {data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex-1" />
        <Btn variant="outline" onClick={exportPdf}><Printer size={14} /> Xuất PDF</Btn>
        <Btn variant="outline" onClick={exportExcel}><Download size={14} /> Xuất báo cáo Excel</Btn>
      </div>

      <div className="bg-white rounded-xl border border-[#E4E6EA] overflow-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-[#F8F9FB] text-[#5B6169] sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Mô tả</th>
              <th className="text-left px-3 py-2 font-medium">Model</th>
              <th className="text-center px-3 py-2 font-medium">ĐVT</th>
              <th className="text-right px-3 py-2 font-medium">KL BoQ</th>
              <th className="text-right px-3 py-2 font-medium">Đặt hàng</th>
              <th className="text-right px-3 py-2 font-medium">% Đặt</th>
              <th className="text-right px-3 py-2 font-medium">Nhận hàng</th>
              <th className="text-right px-3 py-2 font-medium">% Về/Đặt</th>
              <th className="text-right px-3 py-2 font-medium">Workdone</th>
              <th className="text-right px-3 py-2 font-medium">Tồn kho</th>
              <th className="text-left px-3 py-2 font-medium">Cảnh báo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it) => {
              const s = statusByItem.get(it.id);
              return (
                <tr key={it.id} className="border-t border-[#F1F2F4] hover:bg-[#FAFBFC]">
                  <td className="px-3 py-2 font-medium">{it.desc}</td>
                  <td className="px-3 py-2 text-[#5B6169]">{it.model}</td>
                  <td className="px-3 py-2 text-center">{it.unit}</td>
                  <td className="px-3 py-2 text-right">{it.qty.toLocaleString("vi-VN")}</td>
                  <td className="px-3 py-2 text-right">{s.ordered.toLocaleString("vi-VN")}</td>
                  <td className="px-3 py-2 text-right">{s.pctOrder.toFixed(0)}%</td>
                  <td className="px-3 py-2 text-right">{s.received.toLocaleString("vi-VN")}</td>
                  <td className="px-3 py-2 text-right">{s.pctReceived.toFixed(0)}%</td>
                  <td className="px-3 py-2 text-right">{s.workdone.toLocaleString("vi-VN")}</td>
                  <td className="px-3 py-2 text-right">{s.inventory.toLocaleString("vi-VN")}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {s.alerts.length === 0 ? <Badge level="green"><CheckCircle2 size={11} /> OK</Badge> : s.alerts.map((a, i) => <Badge key={i} level={a.level}>{a.text}</Badge>)}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={11} className="text-center py-6 text-[#8A8F98]">Không có dữ liệu phù hợp</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================
   CẬP NHẬT (nhập liệu + khớp mờ)
   ============================================================ */
function CapNhatTab({ data, setData, showToast, canEdit }) {
  const [entryType, setEntryType] = useState("order");
  const [supplierId, setSupplierId] = useState("");
  const [docRef, setDocRef] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rawText, setRawText] = useState("");
  const [parsedRows, setParsedRows] = useState([]);

  const runMatch = () => {
    const rows = parseRawLines(rawText);
    if (!rows.length) { showToast("Không có dữ liệu để phân tích", "err"); return; }
    const matched = rows.map((r) => {
      const m = bestMatch(r.desc, r.model, data.boqItems);
      return { ...r, matchedId: m.item?.id || "", confidence: m.confidence };
    });
    setParsedRows(matched);
    showToast(`Đã phân tích ${matched.length} dòng — kiểm tra khớp bên dưới`);
  };

  const updateRowMatch = (idx, boqId) => {
    setParsedRows((prev) => prev.map((r, i) => i === idx ? { ...r, matchedId: boqId, confidence: 100 } : r));
  };

  const sendToPending = () => {
    if (!parsedRows.length) { showToast("Chưa có dòng nào để gửi", "err"); return; }
    const pendingRows = parsedRows.map((r) => ({
      id: uid(), type: entryType, desc: r.desc, model: r.model, qty: r.qty,
      matchedId: r.matchedId, confidence: r.confidence,
      supplierId: supplierId || null, docRef, date,
    }));
    setData({ ...data, pending: [...data.pending, ...pendingRows] });
    setParsedRows([]);
    setRawText("");
    showToast(`Đã gửi ${pendingRows.length} dòng vào "Chờ xác nhận"`);
  };

  return (
    <div className="flex flex-col gap-5">
      {!canEdit && <PermissionNotice />}
      <div className="bg-white rounded-xl border border-[#E4E6EA] p-4">
        <div className="font-semibold text-[13px] mb-3">Bước 1 — Loại phiếu cập nhật</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Loại phiếu">
            <select className={inputCls} value={entryType} onChange={(e) => setEntryType(e.target.value)}>
              {Object.entries(ENTRY_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Nhà cung cấp / NTP">
            <select className={inputCls} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— chọn —</option>
              {data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              {data.subcontractors.map((s) => <option key={s.id} value={s.id}>{s.name} (NTP)</option>)}
            </select>
          </Field>
          <Field label="Ngày chứng từ"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Số phiếu / tham chiếu"><input className={inputCls} value={docRef} onChange={(e) => setDocRef(e.target.value)} placeholder="VD: PO-CAX-01" /></Field>
        </div>
        <div className="mt-2 text-[12px] text-[#8A8F98]">
          {ENTRY_TYPES[entryType].mode === "sum" ? "Phiếu này sẽ cộng dồn vào khối lượng luỹ kế của đầu mục." : "Phiếu này sẽ ghi đè giá trị luỹ kế mới nhất (Workdone/IPC)."}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#E4E6EA] p-4">
        <div className="font-semibold text-[13px] mb-1">Bước 2 — Dữ liệu chứng từ</div>
        <div className="text-[12px] text-[#8A8F98] mb-2">Dán dữ liệu thô (mỗi dòng: Mô tả [Tab] Model [Tab] Số lượng). App sẽ tự tách bảng và khớp mờ với BoQ.</div>
        <textarea className={`${inputCls} w-full h-28 font-mono text-[12px]`} value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder={"Ống nhựa PPR DN20 PN16\\t\\t500\nỐng nhựa PPR DN25 PN16\\t\\t120"} disabled={!canEdit} />
        <div className="mt-2"><Btn onClick={runMatch} disabled={!canEdit}><Search size={14} /> Phân tích & khớp với BoQ</Btn></div>
      </div>

      {parsedRows.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E4E6EA]">
          <div className="px-4 py-3 border-b border-[#E4E6EA] font-semibold text-[13px]">Kết quả khớp mờ — kiểm tra trước khi gửi duyệt</div>
          <div className="overflow-auto max-h-[360px]">
            <table className="w-full text-[12.5px]">
              <thead className="bg-[#F8F9FB] text-[#5B6169] sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Dữ liệu trên phiếu</th>
                  <th className="text-right px-3 py-2 font-medium">Số lượng</th>
                  <th className="text-left px-3 py-2 font-medium">Khớp với BoQ</th>
                  <th className="text-center px-3 py-2 font-medium">Điểm</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((r, i) => (
                  <tr key={i} className="border-t border-[#F1F2F4]">
                    <td className="px-3 py-2">{r.desc}</td>
                    <td className="px-3 py-2 text-right">{r.qty.toLocaleString("vi-VN")}</td>
                    <td className="px-3 py-2">
                      <select className={inputCls} value={r.matchedId} onChange={(e) => updateRowMatch(i, e.target.value)}>
                        <option value="">— không khớp —</option>
                        {data.boqItems.map((b) => <option key={b.id} value={b.id}>{b.desc}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Badge level={r.confidence >= 80 ? "green" : r.confidence >= 40 ? "amber" : "red"}>{r.confidence}%</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-[#E4E6EA] flex justify-end">
            <Btn onClick={sendToPending} variant="success" disabled={!canEdit}><CheckSquare size={14} /> Gửi vào "Chờ xác nhận"</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   CHỜ XÁC NHẬN
   ============================================================ */
function ChoXacNhanTab({ data, setData, showToast, canEdit }) {
  const approveRow = (id) => {
    const row = data.pending.find((p) => p.id === id);
    if (!row.matchedId) { showToast("Dòng này chưa khớp với BoQ nào", "err"); return; }
    const entry = { id: uid(), boqItemId: row.matchedId, type: row.type, qty: row.qty, date: row.date, supplierId: row.supplierId, docRef: row.docRef };
    setData({ ...data, entries: [...data.entries, entry], pending: data.pending.filter((p) => p.id !== id) });
    showToast("Đã duyệt và ghi vào Tổng hợp");
  };

  const rejectRow = (id) => setData({ ...data, pending: data.pending.filter((p) => p.id !== id) });

  const approveAllHigh = () => {
    const toApprove = data.pending.filter((p) => p.confidence >= 90 && p.matchedId);
    if (!toApprove.length) { showToast("Không có dòng nào ≥ 90% để duyệt hàng loạt", "err"); return; }
    const newEntries = toApprove.map((row) => ({ id: uid(), boqItemId: row.matchedId, type: row.type, qty: row.qty, date: row.date, supplierId: row.supplierId, docRef: row.docRef }));
    const remainIds = new Set(toApprove.map((r) => r.id));
    setData({ ...data, entries: [...data.entries, ...newEntries], pending: data.pending.filter((p) => !remainIds.has(p.id)) });
    showToast(`Đã duyệt hàng loạt ${newEntries.length} dòng ≥ 90%`);
  };

  return (
    <div className="flex flex-col gap-4">
      {!canEdit && <PermissionNotice />}
      <div className="flex items-center justify-between">
        <div className="text-[13px] text-[#5B6169]">{data.pending.length} dòng đang chờ xác nhận trước khi ghi chính thức vào Tổng hợp.</div>
        <Btn variant="outline" onClick={approveAllHigh} disabled={!canEdit}><CheckCircle2 size={14} /> Duyệt tất cả ≥ 90%</Btn>
      </div>

      <div className="bg-white rounded-xl border border-[#E4E6EA] overflow-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-[#F8F9FB] text-[#5B6169] sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Loại phiếu</th>
              <th className="text-left px-3 py-2 font-medium">Dữ liệu trên phiếu</th>
              <th className="text-right px-3 py-2 font-medium">SL</th>
              <th className="text-left px-3 py-2 font-medium">Khớp BoQ</th>
              <th className="text-center px-3 py-2 font-medium">Điểm</th>
              <th className="text-left px-3 py-2 font-medium">Chứng từ</th>
              <th className="text-right px-3 py-2 font-medium">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {data.pending.map((r) => {
              const matched = data.boqItems.find((b) => b.id === r.matchedId);
              return (
                <tr key={r.id} className="border-t border-[#F1F2F4]">
                  <td className="px-3 py-2"><Badge level="blue">{ENTRY_TYPES[r.type].label}</Badge></td>
                  <td className="px-3 py-2">{r.desc}</td>
                  <td className="px-3 py-2 text-right">{r.qty.toLocaleString("vi-VN")}</td>
                  <td className="px-3 py-2">{matched ? matched.desc : <span className="text-[#C0392B]">Chưa khớp</span>}</td>
                  <td className="px-3 py-2 text-center"><Badge level={r.confidence >= 80 ? "green" : r.confidence >= 40 ? "amber" : "red"}>{r.confidence}%</Badge></td>
                  <td className="px-3 py-2 text-[#5B6169]">{r.docRef || "—"} · {r.date}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <Btn size="sm" variant="success" onClick={() => approveRow(r.id)} disabled={!canEdit}><CheckCircle2 size={12} /> Duyệt</Btn>
                      <Btn size="sm" variant="danger" onClick={() => rejectRow(r.id)} disabled={!canEdit}><X size={12} /> Bỏ</Btn>
                    </div>
                  </td>
                </tr>
              );
            })}
            {data.pending.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-[#8A8F98]">Không có dòng nào đang chờ xác nhận</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================
   NHÀ CUNG CẤP
   ============================================================ */
function NccTab({ data, setData, statusByItem, showToast, canEdit, onPrint, projectName }) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState("");
  const [section, setSection] = useState("list"); // list | reconcile

  const addSupplier = () => {
    if (!name) { showToast("Nhập tên NCC", "err"); return; }
    setData({ ...data, suppliers: [...data.suppliers, { id: uid(), name, scope, leadTimeDays: 0 }] });
    setName(""); setScope("");
    showToast("Đã thêm nhà cung cấp");
  };
  const removeSupplier = (id) => setData({ ...data, suppliers: data.suppliers.filter((s) => s.id !== id) });

  return (
    <div className="flex flex-col gap-5">
      {!canEdit && <PermissionNotice />}

      <div className="flex gap-1 bg-white rounded-xl border border-[#E4E6EA] p-1 w-fit">
        <button onClick={() => setSection("list")} className={`px-3 py-1.5 rounded-lg text-[12.5px] font-medium ${section === "list" ? "bg-[#2856C7] text-white" : "text-[#5B6169] hover:bg-[#F1F2F4]"}`}>Danh sách NCC</button>
        <button onClick={() => setSection("reconcile")} className={`px-3 py-1.5 rounded-lg text-[12.5px] font-medium flex items-center gap-1.5 ${section === "reconcile" ? "bg-[#2856C7] text-white" : "text-[#5B6169] hover:bg-[#F1F2F4]"}`}>
          <Receipt size={13} /> Đối chiếu hoá đơn
        </button>
      </div>

      {section === "list" && (
        <>
          <div className="bg-white rounded-xl border border-[#E4E6EA] p-4">
            <div className="font-semibold text-[13px] mb-3">Thêm nhà cung cấp</div>
            <div className="flex flex-wrap gap-3">
              <Field label="Tên NCC"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} /></Field>
              <Field label="Phạm vi cung cấp"><input className={`${inputCls} w-64`} value={scope} onChange={(e) => setScope(e.target.value)} disabled={!canEdit} /></Field>
              <div className="flex items-end"><Btn onClick={addSupplier} disabled={!canEdit}><Plus size={14} /> Thêm</Btn></div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-[#E4E6EA] overflow-auto">
            <table className="w-full text-[12.5px]">
              <thead className="bg-[#F8F9FB] text-[#5B6169]">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Nhà cung cấp</th>
                  <th className="text-left px-3 py-2 font-medium">Phạm vi</th>
                  <th className="text-right px-3 py-2 font-medium">Đầu mục BoQ</th>
                  <th className="text-right px-3 py-2 font-medium">Longlead</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.suppliers.map((s) => {
                  const items = data.boqItems.filter((b) => b.supplierId === s.id);
                  return (
                    <tr key={s.id} className="border-t border-[#F1F2F4]">
                      <td className="px-3 py-2 font-medium">{s.name}</td>
                      <td className="px-3 py-2 text-[#5B6169]">{s.scope}</td>
                      <td className="px-3 py-2 text-right">{items.length}</td>
                      <td className="px-3 py-2 text-right">{s.leadTimeDays} ngày</td>
                      <td className="px-3 py-2 text-right">{canEdit && <button onClick={() => removeSupplier(s.id)} className="text-[#C0392B] hover:bg-[#FDECEC] p-1 rounded"><Trash2 size={13} /></button>}</td>
                    </tr>
                  );
                })}
                {data.suppliers.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-[#8A8F98]">Chưa có nhà cung cấp</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {section === "reconcile" && (
        <InvoiceReconcile data={data} setData={setData} statusByItem={statusByItem} showToast={showToast} canEdit={canEdit} onPrint={onPrint} projectName={projectName} />
      )}
    </div>
  );
}

/* ---------- Đối chiếu hoá đơn nhà cung cấp ---------- */
function InvoiceReconcile({ data, setData, statusByItem, showToast, canEdit, onPrint, projectName }) {
  const [supplierId, setSupplierId] = useState(data.suppliers[0]?.id || "");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rawText, setRawText] = useState("");
  const [openInvoiceId, setOpenInvoiceId] = useState(null);

  const buildInvoice = () => {
    if (!supplierId) { showToast("Chọn nhà cung cấp", "err"); return; }
    const rows = parseRawLines(rawText);
    if (!rows.length) { showToast("Chưa có dữ liệu hoá đơn để đối chiếu", "err"); return; }
    const lines = rows.map((r) => {
      const m = bestMatch(r.desc, r.model, data.boqItems);
      return { desc: r.desc, model: r.model, qty: r.qty, matchedId: m.item?.id || "", confidence: m.confidence };
    });
    const invoice = { id: uid(), supplierId, invoiceNo: invoiceNo || `HD-${Date.now().toString().slice(-6)}`, date, lines };
    setData({ ...data, invoices: [...data.invoices, invoice] });
    setInvoiceNo(""); setRawText("");
    setOpenInvoiceId(invoice.id);
    showToast("Đã tạo đối chiếu hoá đơn");
  };

  const removeInvoice = (id) => setData({ ...data, invoices: data.invoices.filter((i) => i.id !== id) });

  const lineStatus = (line) => {
    const boq = data.boqItems.find((b) => b.id === line.matchedId);
    if (!boq || line.confidence < 40) return { level: "red", text: "Ngoài danh mục", ordered: null, diff: null };
    const s = statusByItem.get(boq.id);
    const diff = line.qty - s.ordered;
    if (Math.abs(diff) < 1e-6) return { level: "green", text: "Khớp luỹ kế đặt hàng", ordered: s.ordered, diff };
    return { level: "amber", text: diff > 0 ? `Hoá đơn > Đặt hàng (+${diff.toLocaleString("vi-VN")})` : `Hoá đơn < Đặt hàng (${diff.toLocaleString("vi-VN")})`, ordered: s.ordered, diff };
  };

  const printInvoice = (inv) => {
    const supplier = data.suppliers.find((s) => s.id === inv.supplierId);
    const columns = ["Mô tả trên hoá đơn", "Model", "SL hoá đơn", "Khớp BoQ", "Luỹ kế đặt hàng", "Lệch", "Trạng thái"];
    const rows = inv.lines.map((l) => {
      const boq = data.boqItems.find((b) => b.id === l.matchedId);
      const st = lineStatus(l);
      return [l.desc, l.model, l.qty.toLocaleString("vi-VN"), boq ? boq.desc : "—", st.ordered != null ? st.ordered.toLocaleString("vi-VN") : "—", st.diff != null ? st.diff.toLocaleString("vi-VN") : "—", st.text];
    });
    onPrint({ title: `Đối chiếu hoá đơn ${inv.invoiceNo}`, subtitle: `${projectName} — NCC: ${supplier?.name || "—"} — ngày HĐ: ${inv.date}`, columns, rows });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-white rounded-xl border border-[#E4E6EA] p-4">
        <div className="font-semibold text-[13px] mb-1">Tạo đối chiếu hoá đơn mới</div>
        <div className="text-[12px] text-[#8A8F98] mb-3">Dán các dòng trên hoá đơn (Mô tả [Tab] Model [Tab] Số lượng). App tự khớp mờ với BoQ và so với luỹ kế đặt hàng theo hợp đồng.</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
          <Field label="Nhà cung cấp *">
            <select className={inputCls} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={!canEdit}>
              <option value="">— chọn —</option>
              {data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Số hoá đơn"><input className={inputCls} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="VD: 00001234" disabled={!canEdit} /></Field>
          <Field label="Ngày hoá đơn"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} disabled={!canEdit} /></Field>
        </div>
        <textarea className={`${inputCls} w-full h-24 font-mono text-[12px]`} value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder={"Ống nhựa PPR DN20 PN16\\t\\t500\nỐng nhựa PPR DN25 PN16\\t\\t120"} disabled={!canEdit} />
        <div className="mt-2"><Btn onClick={buildInvoice} disabled={!canEdit}><Receipt size={14} /> Đối chiếu</Btn></div>
      </div>

      <div className="flex flex-col gap-3">
        {data.invoices.filter((i) => !supplierId || i.supplierId === supplierId).map((inv) => {
          const supplier = data.suppliers.find((s) => s.id === inv.supplierId);
          const open = openInvoiceId === inv.id;
          const counts = { green: 0, amber: 0, red: 0 };
          inv.lines.forEach((l) => { counts[lineStatus(l).level]++; });
          return (
            <div key={inv.id} className="bg-white rounded-xl border border-[#E4E6EA]">
              <button onClick={() => setOpenInvoiceId(open ? null : inv.id)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                <div className="flex items-center gap-3">
                  <ChevronDown size={14} className={`text-[#8A8F98] transition-transform ${open ? "rotate-180" : ""}`} />
                  <div>
                    <div className="font-semibold text-[13px]">Hoá đơn {inv.invoiceNo} <span className="text-[#8A8F98] font-normal">· {supplier?.name} · {inv.date}</span></div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {counts.green > 0 && <Badge level="green">{counts.green} khớp</Badge>}
                  {counts.amber > 0 && <Badge level="amber">{counts.amber} lệch</Badge>}
                  {counts.red > 0 && <Badge level="red">{counts.red} ngoài danh mục</Badge>}
                </div>
              </button>
              {open && (
                <div>
                  <div className="overflow-auto max-h-[320px] border-t border-[#E4E6EA]">
                    <table className="w-full text-[12.5px]">
                      <thead className="bg-[#F8F9FB] text-[#5B6169] sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Mô tả trên hoá đơn</th>
                          <th className="text-right px-3 py-2 font-medium">SL hoá đơn</th>
                          <th className="text-left px-3 py-2 font-medium">Khớp BoQ</th>
                          <th className="text-right px-3 py-2 font-medium">Luỹ kế đặt hàng</th>
                          <th className="text-left px-3 py-2 font-medium">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inv.lines.map((l, i) => {
                          const boq = data.boqItems.find((b) => b.id === l.matchedId);
                          const st = lineStatus(l);
                          return (
                            <tr key={i} className="border-t border-[#F1F2F4]">
                              <td className="px-3 py-2">{l.desc}</td>
                              <td className="px-3 py-2 text-right">{l.qty.toLocaleString("vi-VN")}</td>
                              <td className="px-3 py-2">{boq ? boq.desc : <span className="text-[#C0392B]">Không tìm thấy</span>}</td>
                              <td className="px-3 py-2 text-right">{st.ordered != null ? st.ordered.toLocaleString("vi-VN") : "—"}</td>
                              <td className="px-3 py-2"><Badge level={st.level}>{st.text}</Badge></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="p-3 border-t border-[#E4E6EA] flex justify-end gap-2">
                    <Btn size="sm" variant="outline" onClick={() => printInvoice(inv)}><Printer size={12} /> In / Xuất PDF</Btn>
                    {canEdit && <Btn size="sm" variant="danger" onClick={() => removeInvoice(inv.id)}><Trash2 size={12} /> Xoá</Btn>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {data.invoices.filter((i) => !supplierId || i.supplierId === supplierId).length === 0 && (
          <div className="text-center py-6 text-[#8A8F98] text-[13px] bg-white rounded-xl border border-[#E4E6EA]">Chưa có hoá đơn nào được đối chiếu</div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   NHÀ THẦU PHỤ
   ============================================================ */
function NtpTab({ data, setData, showToast, canEdit }) {
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [minuteType, setMinuteType] = useState("Biên bản khấu trừ (có giá trị)");
  const [minuteValue, setMinuteValue] = useState("");
  const [minuteNote, setMinuteNote] = useState("");
  const [selectedNtp, setSelectedNtp] = useState("");

  const addSub = () => {
    if (!name) { showToast("Nhập tên nhà thầu phụ", "err"); return; }
    setData({ ...data, subcontractors: [...data.subcontractors, { id: uid(), name, shortName: shortName || name, minutes: [] }] });
    setName(""); setShortName("");
    showToast("Đã thêm nhà thầu phụ");
  };
  const removeSub = (id) => setData({ ...data, subcontractors: data.subcontractors.filter((s) => s.id !== id) });

  const addMinute = () => {
    if (!selectedNtp || !minuteNote) { showToast("Chọn NTP và nhập nội dung biên bản", "err"); return; }
    const minute = { id: uid(), type: minuteType, value: Number(minuteValue) || 0, note: minuteNote, date: new Date().toISOString().slice(0, 10) };
    setData({
      ...data,
      subcontractors: data.subcontractors.map((s) => s.id === selectedNtp ? { ...s, minutes: [...(s.minutes || []), minute] } : s),
    });
    setMinuteValue(""); setMinuteNote("");
    showToast("Đã lưu biên bản");
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-white rounded-xl border border-[#E4E6EA] p-4">
        <div className="font-semibold text-[13px] mb-3">Danh mục nhà thầu phụ</div>
        <div className="flex flex-wrap gap-3">
          <Field label="Tên đầy đủ"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Công ty TNHH Xây lắp ABC" /></Field>
          <Field label="Tên viết gọn"><input className={inputCls} value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="tự tạo" /></Field>
          <div className="flex items-end"><Btn onClick={addSub} disabled={!canEdit}><Plus size={14} /> Thêm nhà thầu phụ</Btn></div>
        </div>
        <table className="w-full text-[12.5px] mt-4">
          <thead className="text-[#5B6169]"><tr><th className="text-left px-2 py-1.5 font-medium">Tên đầy đủ</th><th className="text-left px-2 py-1.5 font-medium">Tên viết gọn</th><th className="text-right px-2 py-1.5 font-medium">Số biên bản</th><th></th></tr></thead>
          <tbody>
            {data.subcontractors.map((s) => (
              <tr key={s.id} className="border-t border-[#F1F2F4]">
                <td className="px-2 py-1.5">{s.name}</td>
                <td className="px-2 py-1.5">{s.shortName}</td>
                <td className="px-2 py-1.5 text-right">{(s.minutes || []).length}</td>
                <td className="px-2 py-1.5 text-right">{canEdit && <button onClick={() => removeSub(s.id)} className="text-[#C0392B] hover:bg-[#FDECEC] p-1 rounded"><Trash2 size={13} /></button>}</td>
              </tr>
            ))}
            {data.subcontractors.length === 0 && <tr><td colSpan={4} className="text-center py-4 text-[#8A8F98]">Chưa có nhà thầu phụ</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-[#E4E6EA] p-4">
        <div className="font-semibold text-[13px] mb-3">Lưu biên bản nhà thầu phụ</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Nhà thầu phụ *">
            <select className={inputCls} value={selectedNtp} onChange={(e) => setSelectedNtp(e.target.value)}>
              <option value="">— chọn —</option>
              {data.subcontractors.map((s) => <option key={s.id} value={s.id}>{s.shortName}</option>)}
            </select>
          </Field>
          <Field label="Loại biên bản">
            <select className={inputCls} value={minuteType} onChange={(e) => setMinuteType(e.target.value)}>
              <option>Biên bản khấu trừ (có giá trị)</option>
              <option>Biên bản nghiệm thu</option>
              <option>Biên bản phạt</option>
              <option>Biên bản khác</option>
            </select>
          </Field>
          <Field label="Giá trị (VNĐ)"><input type="number" className={inputCls} value={minuteValue} onChange={(e) => setMinuteValue(e.target.value)} placeholder="VD: 12500000" /></Field>
        </div>
        <Field label="Nội dung biên bản *">
          <textarea className={`${inputCls} w-full h-16 mt-1`} value={minuteNote} onChange={(e) => setMinuteNote(e.target.value)} placeholder="VD: Khấu trừ vật tư hao hụt đợt 3" disabled={!canEdit} />
        </Field>
        <div className="mt-2"><Btn onClick={addMinute} disabled={!canEdit}><Plus size={14} /> Lưu biên bản</Btn></div>

        {selectedNtp && (
          <div className="mt-4">
            <div className="text-[12px] font-semibold text-[#5B6169] mb-1">Lịch sử biên bản</div>
            <table className="w-full text-[12.5px]">
              <thead className="text-[#5B6169]"><tr><th className="text-left px-2 py-1 font-medium">Ngày</th><th className="text-left px-2 py-1 font-medium">Loại</th><th className="text-left px-2 py-1 font-medium">Nội dung</th><th className="text-right px-2 py-1 font-medium">Giá trị</th></tr></thead>
              <tbody>
                {(data.subcontractors.find((s) => s.id === selectedNtp)?.minutes || []).map((m) => (
                  <tr key={m.id} className="border-t border-[#F1F2F4]">
                    <td className="px-2 py-1">{m.date}</td><td className="px-2 py-1">{m.type}</td><td className="px-2 py-1">{m.note}</td><td className="px-2 py-1 text-right">{m.value.toLocaleString("vi-VN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   SETTINGS
   ============================================================ */
function SettingsTab({ data, setData, showToast, isAdmin }) {
  const [projectName, setProjectName] = useState(data.meta.projectName);

  const save = () => {
    setData({ ...data, meta: { ...data.meta, projectName } });
    showToast("Đã lưu cài đặt");
  };

  const resetDemo = () => {
    setData(demoData());
    showToast("Đã đặt lại dữ liệu mẫu");
  };

  const clearAll = () => {
    setData({ meta: { projectName, createdAt: Date.now() }, suppliers: [], subcontractors: [], boqItems: [], entries: [], pending: [] });
    showToast("Đã xoá toàn bộ dữ liệu dự án");
  };

  return (
    <div className="flex flex-col gap-5 max-w-xl">
      <div className="bg-white rounded-xl border border-[#E4E6EA] p-4">
        <div className="font-semibold text-[13px] mb-3">Thông tin dự án</div>
        <Field label="Tên dự án">
          <input className={inputCls} value={projectName} onChange={(e) => setProjectName(e.target.value)} />
        </Field>
        <div className="mt-3"><Btn onClick={save}>Lưu</Btn></div>
      </div>

      <div className="bg-white rounded-xl border border-[#E4E6EA] p-4">
        <div className="font-semibold text-[13px] mb-1">Dữ liệu</div>
        <div className="text-[12px] text-[#8A8F98] mb-3">Dữ liệu được lưu trên máy chủ (Netlify Blobs) và dùng chung cho mọi người truy cập trang này.</div>
        <div className="flex gap-2">
          <Btn variant="outline" onClick={resetDemo}><RefreshCw size={14} /> Nạp lại dữ liệu mẫu</Btn>
          {isAdmin ? (
            <Btn variant="danger" onClick={clearAll}><Trash2 size={14} /> Xoá toàn bộ dữ liệu</Btn>
          ) : (
            <span className="text-[11px] text-[#8A8F98] flex items-center gap-1.5"><Lock size={12} /> Chỉ Quản trị viên mới được xoá toàn bộ dữ liệu.</span>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#E4E6EA] p-4">
        <div className="font-semibold text-[13px] mb-1">Phân quyền trong hệ thống</div>
        <div className="text-[12px] text-[#8A8F98] mb-3">Vai trò được chọn khi đăng nhập, áp dụng cho cả phiên làm việc.</div>
        <div className="flex flex-col gap-2">
          {Object.entries(ROLES).map(([key, r]) => {
            const Icon = r.icon;
            return (
              <div key={key} className="flex items-center gap-2 text-[12.5px]">
                <Icon size={14} style={{ color: r.color }} />
                <span className="font-medium w-24">{r.label}</span>
                <span className="text-[#8A8F98]">
                  {key === "admin" && "Toàn quyền: thêm/sửa/xoá dữ liệu, duyệt phiếu, xoá toàn bộ dự án."}
                  {key === "editor" && "Thêm/sửa/xoá dữ liệu nghiệp vụ, duyệt phiếu — không xoá được toàn bộ dự án."}
                  {key === "viewer" && "Chỉ xem, lọc, tìm kiếm và xuất báo cáo (Excel/PDF)."}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return <LoginGate />;
}
