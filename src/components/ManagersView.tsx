import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/bits';
import type { Platform } from '@/lib/platform';
import {
  EMPTY_ROLES, isEmail, normalizeEmail, ROLE_LABEL,
  type Role, type RoleEntry, type RolesDoc, type Session,
} from '@/lib/auth';
import { fmtDateTime } from '@/lib/domain';
import { cn } from '@/lib/utils';

/**
 * Admin console: who may run attendance. Granting "Người quản lý" lets that
 * address sign in and issue QR codes; "Quản trị viên" additionally lets them
 * appoint others.
 */
export function ManagersView({ p, session, roles }: { p: Platform; session: Session; roles: RolesDoc | null }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('manager');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // email of the entry being edited
  const [confirmDemote, setConfirmDemote] = useState(false);

  const entries = useMemo(() => {
    const list = roles?.entries ?? [];
    const rank: Record<Role, number> = { admin: 0, manager: 1 };
    return [...list].sort((a, b) => rank[a.role] - rank[b.role] || a.email.localeCompare(b.email));
  }, [roles]);

  // A self-hosted server marks its bootstrap admin `locked`; the page-owner row below is only for claude.ai.
  const hasLocked = entries.some((e) => e.locked);

  async function write(next: RoleEntry[]) {
    await p.db.doc('config/roles').set({ entries: next } satisfies RolesDoc as unknown as Record<string, unknown>);
  }

  // An admin lowering their own role loses this console at once, so it takes a second, explicit click.
  const demotingSelf = !!editing && normalizeEmail(editing) === session.email && role !== 'admin'
    && roles?.entries.find((e) => normalizeEmail(e.email) === normalizeEmail(editing))?.role === 'admin';

  function startEdit(e: RoleEntry) {
    setConfirmDemote(false);
    setEditing(e.email);
    setEmail(e.email);
    setName(e.name ?? '');
    setRole(e.role);
    setNote(null);
    setConfirmDrop(null);
  }

  function cancelEdit() {
    setConfirmDemote(false);
    setEditing(null);
    setEmail('');
    setName('');
    setRole('manager');
    setNote(null);
  }

  async function add(ev: React.FormEvent) {
    ev.preventDefault();
    const addr = normalizeEmail(email);
    if (!isEmail(addr)) return setNote({ tone: 'bad', text: 'Địa chỉ email chưa hợp lệ.' });

    const current = roles?.entries ?? EMPTY_ROLES.entries;
    const existing = current.find((e) => normalizeEmail(e.email) === addr);
    if (existing?.locked) {
      return setNote({ tone: 'warn', text: `${addr} là quản trị viên mặc định của máy chủ nên không thể thay đổi.` });
    }
    if (editing && !existing) {
      // Someone revoked this grant while the form was open: saving must not silently bring it back.
      cancelEdit();
      return setNote({ tone: 'warn', text: `${addr} không còn trong danh sách quyền (có thể vừa bị thu hồi). Hãy thêm lại nếu bạn vẫn muốn cấp quyền.` });
    }
    if (demotingSelf && !confirmDemote) {
      setConfirmDemote(true);
      return setNote({ tone: 'warn', text: 'Bạn đang hạ vai trò của chính mình xuống người quản lý: bạn sẽ mất tab Quản trị ngay và chỉ một quản trị viên khác mới cấp lại được. Bấm "Xác nhận hạ vai trò" để tiếp tục.' });
    }
    if (!editing && existing?.role === role) {
      return setNote({ tone: 'warn', text: `${addr} đã là ${ROLE_LABEL[role].toLowerCase()}.` });
    }

    setBusy(true);
    try {
      const entry: RoleEntry = editing && existing
        ? { ...existing, name: name.trim(), role } // editing keeps who granted it and when
        : {
          email: addr,
          name: name.trim() || existing?.name || '',
          role,
          addedAt: new Date().toISOString(),
          addedBy: session.email,
        };
      await write([...current.filter((e) => normalizeEmail(e.email) !== addr), entry]);
      setEmail('');
      setName('');
      if (editing) {
        setEditing(null);
        setRole('manager');
        setConfirmDemote(false);
      }
      setNote({
        tone: 'ok',
        text: editing
          ? `Đã cập nhật ${addr}.`
          : existing
            ? `Đã đổi quyền của ${addr} thành ${ROLE_LABEL[role].toLowerCase()}.`
            : `Đã thêm ${addr} làm ${ROLE_LABEL[role].toLowerCase()}. Người này đăng nhập bằng đúng email trên là dùng được ngay.`,
      });
    } catch (e: any) {
      setNote({ tone: 'bad', text: permissionMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function drop(addr: string) {
    setBusy(true);
    try {
      await write((roles?.entries ?? []).filter((e) => normalizeEmail(e.email) !== normalizeEmail(addr)));
      if (editing && normalizeEmail(editing) === normalizeEmail(addr)) cancelEdit();
      setNote({ tone: 'ok', text: `Đã thu hồi quyền của ${addr}.` });
    } catch (e: any) {
      setNote({ tone: 'bad', text: permissionMessage(e) });
    } finally {
      setBusy(false);
      setConfirmDrop(null);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <section className="space-y-3">
        <div className="eyebrow">{editing ? 'Sửa người quản lý' : 'Cấp quyền'}</div>
        <form onSubmit={add} className="grid gap-3 rounded-md border bg-card p-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="r-email">Email người được cấp quyền</Label>
            <Input id="r-email" className="mono" inputMode="email" autoComplete="off" value={email} disabled={!!editing}
              onChange={(e) => { setEmail(e.target.value); setNote(null); }} placeholder="nguyen.van.a@tbd.edu.vn" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="r-name">Họ tên (tuỳ chọn)</Label>
            <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn A" />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium" id="r-role-label">Vai trò</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="r-role-label">
              {(['manager', 'admin'] as const).map((r) => (
                <Button key={r} type="button" size="sm" role="radio" aria-checked={role === r} className="h-8"
                  variant={role === r ? 'default' : 'outline'} onClick={() => { setRole(r); setConfirmDemote(false); }}>
                  {ROLE_LABEL[r]}
                </Button>
              ))}
            </div>
            <p className="text-[13px] text-muted-foreground">
              {role === 'manager'
                ? 'Tạo sự kiện, sinh mã QR; sửa (trước giờ bắt đầu), xoá, theo dõi và xuất danh sách điểm danh của sự kiện do mình tạo.'
                : 'Toàn quyền của người quản lý, cộng thêm quản lý mọi sự kiện và quyền cấp, sửa, thu hồi quyền cho người khác.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !email.trim()}>{busy ? 'Đang lưu…' : demotingSelf && confirmDemote ? 'Xác nhận hạ vai trò' : editing ? 'Lưu thay đổi' : 'Thêm người quản lý'}</Button>
            {editing && <Button type="button" variant="ghost" disabled={busy} onClick={cancelEdit}>Huỷ sửa</Button>}
          </div>
        </form>

        {note && <Notice tone={note.tone}>{note.text}</Notice>}

        <Notice tone="info" title="Cách hoạt động">
          Quyền gắn với địa chỉ email. Người được cấp đăng nhập bằng đúng email đó sẽ thấy tab
          <b> Quản lý</b>. Người tham dự không cần quyền gì — họ chỉ cần có tên trong danh sách mời của sự kiện.
        </Notice>
      </section>

      <section className="min-w-0 space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Người có quyền</div>
            <div className="num text-3xl font-bold leading-none">{entries.length + (hasLocked ? 0 : 1)}</div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-muted/60 text-left text-[12px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Người dùng</th>
                <th className="px-3 py-2 font-medium">Vai trò</th>
                <th className="px-3 py-2 font-medium">Được cấp</th>
                <th className="px-3 py-2 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {/* The artifact owner is an admin by construction and cannot be demoted here. */}
              {!hasLocked && <tr className="bg-accent/30">
                <td className="px-3 py-2">
                  <div className="font-medium">{p.me.name || 'Chủ sở hữu trang'}</div>
                  <div className="mono truncate text-[12px] text-muted-foreground">{p.me.email ?? 'Tài khoản sở hữu trang claude.ai'}</div>
                </td>
                <td className="px-3 py-2">
                  <RolePill role="admin" />
                </td>
                <td className="px-3 py-2 text-[12px] text-muted-foreground">Mặc định</td>
                <td className="px-3 py-2 text-right text-[12px] text-muted-foreground">Không thể thu hồi</td>
              </tr>}
              {entries.map((e) => {
                const isSelf = normalizeEmail(e.email) === session.email;
                return (
                  <tr key={e.email}>
                    <td className="max-w-[300px] px-3 py-2">
                      {e.name && <div className="truncate font-medium">{e.name}</div>}
                      <div className="mono truncate text-[13px] text-muted-foreground" title={e.email}>{e.email}</div>
                    </td>
                    <td className="px-3 py-2"><RolePill role={e.role} /></td>
                    <td className="px-3 py-2 text-[12px] text-muted-foreground">
                      <div className="num">{fmtDateTime(e.addedAt)}</div>
                      {e.addedBy && <div className="mono truncate">bởi {e.addedBy}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {e.locked ? (
                        <span className="text-[12px] text-muted-foreground">Mặc định · không thể sửa hay thu hồi</span>
                      ) : confirmDrop === e.email ? (
                        <span className="inline-flex gap-1">
                          <Button size="sm" variant="destructive" disabled={busy} onClick={() => drop(e.email)}>Xác nhận</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDrop(null)}>Huỷ</Button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" disabled={busy} aria-label={`Sửa ${e.email}`} onClick={() => startEdit(e)}>Sửa</Button>
                          <Button size="sm" variant="ghost" className="text-bad hover:text-bad" disabled={busy}
                            onClick={() => setConfirmDrop(e.email)}>
                            {isSelf ? 'Bỏ quyền của tôi' : 'Thu hồi'}
                          </Button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {entries.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Chưa cấp quyền cho ai ngoài chủ sở hữu trang.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {confirmDrop && normalizeEmail(confirmDrop) === session.email && (
          <Notice tone="warn" title="Bạn đang thu hồi quyền của chính mình">
            Sau khi xác nhận bạn sẽ mất tab Quản trị, trừ khi bạn là chủ sở hữu trang.
          </Notice>
        )}
      </section>
    </div>
  );
}

function RolePill({ role }: { role: Role }) {
  return (
    <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold',
      role === 'admin' ? 'bg-bad-soft text-bad' : 'bg-ok-soft text-ok')}>
      {ROLE_LABEL[role]}
    </span>
  );
}

function permissionMessage(e: any): string {
  if (e?.code === 'invalid_argument') {
    return 'Tài khoản này không có quyền ghi dữ liệu trang (cần quyền "Có thể chỉnh sửa" trên artifact).';
  }
  return e?.message || 'Không lưu được danh sách quyền.';
}
