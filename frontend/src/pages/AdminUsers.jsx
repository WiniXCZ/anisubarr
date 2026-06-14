import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Trash2, Shield, X, Eye, EyeOff, Settings2 } from "lucide-react";
import { getMe, getUsers, createUser, updateUser, deleteUser, updateUserPermissions } from "../api/client";
import clsx from "clsx";

// ── Constants ─────────────────────────────

const PERM_LABELS = {
  can_download_subtitles: "Stahovat titulky",
  can_manage_library:     "Spravovat knihovnu",
  can_edit_subtitles:     "Upravovat titulky",
  can_run_sync:           "Spouštět synchronizaci",
  can_manage_requests:    "Spravovat požadavky",
  can_view_files:         "Prohlížet soubory",
  can_access_settings:    "Přístup k nastavení",
};

const DEFAULT_PERMS = Object.fromEntries(Object.keys(PERM_LABELS).map((k) => [k, false]));

const ROLE_META = {
  viewer: { label: "Viewer", color: "text-muted border-border bg-transparent" },
  custom: { label: "Custom", color: "text-blue-400 border-blue-400/40 bg-blue-400/5" },
  admin:  { label: "Admin",  color: "text-accent border-accent/40 bg-accent/5" },
};

// ── Toggle ────────────────────────────────

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={clsx(
        "relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none",
        checked ? "bg-accent" : "bg-border",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
      )}
    >
      <span
        className={clsx(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  );
}

// ── Role select ───────────────────────────

function RoleSelect({ value, onChange, disabled }) {
  const meta = ROLE_META[value] ?? ROLE_META.viewer;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={clsx(
        "text-xs font-medium px-2 py-1 rounded-md border transition-colors focus:outline-none",
        "bg-transparent cursor-pointer",
        meta.color,
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      <option value="viewer">Viewer</option>
      <option value="custom">Custom</option>
      <option value="admin">Admin</option>
    </select>
  );
}

// ── Modal — přidat uživatele ───────────────

function AddUserModal({ onClose, onSubmit, isPending }) {
  const [form, setForm]         = useState({ username: "", password: "", email: "", role: "viewer" });
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState(null);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!form.username.trim() || !form.password.trim()) {
      setError("Username a heslo jsou povinné.");
      return;
    }
    try {
      await onSubmit({
        username: form.username.trim(),
        password: form.password,
        email:    form.email.trim() || null,
        role:     form.role,
      });
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail ?? "Chyba při vytváření uživatele.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-text">Přidat uživatele</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted hover:text-text hover:bg-border transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted mb-1.5">
              Uživatelské jméno <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
              autoFocus
              className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-text text-sm placeholder-muted focus:outline-none focus:border-accent transition-colors"
              placeholder="admin, jan.novak…"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted mb-1.5">
              Heslo <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <input
                type={showPass ? "text" : "password"}
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                className="w-full px-3 py-2 pr-10 rounded-lg bg-bg border border-border text-text text-sm placeholder-muted focus:outline-none focus:border-accent transition-colors"
                placeholder="Silné heslo…"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text transition-colors"
              >
                {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted mb-1.5">
              E-mail <span className="text-muted text-xs">(volitelný)</span>
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-text text-sm placeholder-muted focus:outline-none focus:border-accent transition-colors"
              placeholder="jan@example.com"
            />
          </div>

          <div className="flex items-center justify-between py-1">
            <span className="text-sm font-medium text-muted">Role</span>
            <div className="flex gap-1.5">
              {["viewer", "custom", "admin"].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => set("role", r)}
                  className={clsx(
                    "px-3 py-1 text-xs font-medium rounded-md border transition-colors",
                    form.role === r
                      ? ROLE_META[r].color
                      : "text-muted border-border bg-transparent hover:border-muted"
                  )}
                >
                  {ROLE_META[r].label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm rounded-lg border border-border text-muted hover:text-text hover:bg-border transition-colors"
            >
              Zrušit
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 px-4 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors font-medium"
            >
              {isPending ? "Ukládám…" : "Vytvořit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Modal — změna hesla ───────────────────

function ChangePasswordModal({ user, onClose, onSubmit, isPending }) {
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!password.trim()) { setError("Heslo nesmí být prázdné."); return; }
    try {
      await onSubmit(user.id, { password });
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail ?? "Chyba při změně hesla.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-text">Změna hesla</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted hover:text-text hover:bg-border transition-colors">
            <X size={16} />
          </button>
        </div>
        <p className="text-sm text-muted mb-4">
          Nastavit nové heslo pro <span className="text-text font-medium">{user.username}</span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              type={showPass ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 pr-10 rounded-lg bg-bg border border-border text-text text-sm placeholder-muted focus:outline-none focus:border-accent transition-colors"
              placeholder="Nové heslo…"
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text transition-colors"
            >
              {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm rounded-lg border border-border text-muted hover:text-text hover:bg-border transition-colors">
              Zrušit
            </button>
            <button type="submit" disabled={isPending} className="flex-1 px-4 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors font-medium">
              {isPending ? "Ukládám…" : "Uložit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Modal — oprávnění (custom role) ───────

function PermissionsModal({ user, onClose, onSave, isPending }) {
  const initial = { ...DEFAULT_PERMS, ...(user.permissions ?? {}) };
  const [perms, setPerms] = useState(initial);
  const [error, setError] = useState(null);

  function toggle(key) {
    setPerms((p) => ({ ...p, [key]: !p[key] }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await onSave(user.id, perms);
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail ?? "Chyba při ukládání oprávnění.");
    }
  }

  const allOn  = Object.values(perms).every(Boolean);
  const allOff = Object.values(perms).every((v) => !v);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-text">Oprávnění</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted hover:text-text hover:bg-border transition-colors">
            <X size={16} />
          </button>
        </div>
        <p className="text-sm text-muted mb-5">
          Vlastní oprávnění pro <span className="text-text font-medium">{user.username}</span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Quick toggle all */}
          <div className="flex gap-2 mb-1">
            <button
              type="button"
              onClick={() => setPerms(Object.fromEntries(Object.keys(DEFAULT_PERMS).map((k) => [k, true])))}
              disabled={allOn}
              className="text-xs text-accent hover:underline disabled:opacity-30 disabled:no-underline"
            >
              Vše povolit
            </button>
            <span className="text-muted text-xs">·</span>
            <button
              type="button"
              onClick={() => setPerms({ ...DEFAULT_PERMS })}
              disabled={allOff}
              className="text-xs text-muted hover:text-text hover:underline disabled:opacity-30 disabled:no-underline"
            >
              Vše zakázat
            </button>
          </div>

          <div className="space-y-2.5">
            {Object.entries(PERM_LABELS).map(([key, label]) => (
              <label key={key} className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={perms[key] ?? false}
                  onChange={() => toggle(key)}
                  className="w-4 h-4 rounded accent-accent cursor-pointer"
                />
                <span className="text-sm text-text group-hover:text-accent transition-colors">{label}</span>
              </label>
            ))}
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm rounded-lg border border-border text-muted hover:text-text hover:bg-border transition-colors">
              Zrušit
            </button>
            <button type="submit" disabled={isPending} className="flex-1 px-4 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors font-medium">
              {isPending ? "Ukládám…" : "Uložit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Hlavní stránka ────────────────────────

export default function AdminUsers() {
  const navigate    = useNavigate();
  const queryClient = useQueryClient();

  const [showAddModal,   setShowAddModal]   = useState(false);
  const [changePwUser,   setChangePwUser]   = useState(null);
  const [permissionsUser, setPermissionsUser] = useState(null);
  const [deleteConfirm,  setDeleteConfirm]  = useState(null);

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["me"],
    queryFn:  () => getMe().then((r) => r.data),
  });

  if (!meLoading && me && !me.is_admin) {
    navigate("/", { replace: true });
    return null;
  }

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn:  () => getUsers().then((r) => r.data),
    enabled:  !!me?.is_admin,
  });

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateUser(id, data),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDeleteConfirm(null);
    },
  });

  const permsMutation = useMutation({
    mutationFn: ({ id, data }) => updateUserPermissions(id, data),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  function handleRoleChange(user, newRole) {
    updateMutation.mutate({ id: user.id, data: { role: newRole } });
    if (newRole === "custom") {
      setPermissionsUser(user);
    }
  }

  function handleToggleActive(user) {
    updateMutation.mutate({ id: user.id, data: { is_active: !user.is_active } });
  }

  if (meLoading || (!me && !meLoading)) {
    return <div className="flex items-center justify-center py-24 text-muted text-sm">Načítám…</div>;
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-text">Správa uživatelů</h1>
          <p className="text-sm text-muted mt-0.5">
            {users.length} {users.length === 1 ? "uživatel" : users.length < 5 ? "uživatelé" : "uživatelů"}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-accent/10 text-accent hover:bg-accent/20 transition-colors font-medium"
        >
          <UserPlus size={14} />
          Přidat uživatele
        </button>
      </div>

      {/* Tabulka */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-muted text-sm">Načítám uživatele…</div>
        ) : users.length === 0 ? (
          <div className="py-16 text-center text-muted text-sm">Žádní uživatelé</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-bg/50">
                <th className="text-left text-xs font-medium text-muted px-4 py-3 uppercase tracking-wide">Uživatel</th>
                <th className="text-left text-xs font-medium text-muted px-4 py-3 uppercase tracking-wide hidden sm:table-cell">E-mail</th>
                <th className="text-center text-xs font-medium text-muted px-4 py-3 uppercase tracking-wide">Role</th>
                <th className="text-center text-xs font-medium text-muted px-4 py-3 uppercase tracking-wide">Aktivní</th>
                <th className="text-right text-xs font-medium text-muted px-4 py-3 uppercase tracking-wide">Akce</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((user) => {
                const isSelf     = user.id === me?.id;
                const isUpdating = updateMutation.isPending && updateMutation.variables?.id === user.id;
                const role       = user.role ?? "viewer";

                return (
                  <tr
                    key={user.id}
                    className={clsx("transition-colors hover:bg-bg/40", !user.is_active && "opacity-50")}
                  >
                    {/* Username */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text">{user.username}</span>
                        {isSelf && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-accent/15 text-accent">
                            já
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Email */}
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-sm text-muted">{user.email ?? "—"}</span>
                    </td>

                    {/* Role */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <RoleSelect
                          value={role}
                          onChange={(newRole) => handleRoleChange(user, newRole)}
                          disabled={isUpdating || isSelf}
                        />
                        {role === "custom" && (
                          <button
                            onClick={() => setPermissionsUser(user)}
                            title="Spravovat oprávnění"
                            className="p-1 rounded text-blue-400/60 hover:text-blue-400 hover:bg-blue-400/10 transition-colors"
                          >
                            <Settings2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>

                    {/* is_active toggle */}
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center" title={isSelf ? "Nemůžeš deaktivovat vlastní účet" : undefined}>
                        <Toggle
                          checked={user.is_active}
                          onChange={() => handleToggleActive(user)}
                          disabled={isUpdating || isSelf}
                        />
                      </div>
                    </td>

                    {/* Akce */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setChangePwUser(user)}
                          title="Změnit heslo"
                          className="p-1.5 rounded-md text-muted hover:text-text hover:bg-border transition-colors"
                        >
                          <Shield size={14} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(user.id)}
                          disabled={isSelf}
                          title={isSelf ? "Nemůžeš smazat sám sebe" : "Smazat uživatele"}
                          className={clsx(
                            "p-1.5 rounded-md transition-colors",
                            isSelf
                              ? "text-muted/30 cursor-not-allowed"
                              : "text-muted hover:text-red-400 hover:bg-red-400/10"
                          )}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal — přidat uživatele */}
      {showAddModal && (
        <AddUserModal
          onClose={() => setShowAddModal(false)}
          onSubmit={(data) => createMutation.mutateAsync(data)}
          isPending={createMutation.isPending}
        />
      )}

      {/* Modal — změna hesla */}
      {changePwUser && (
        <ChangePasswordModal
          user={changePwUser}
          onClose={() => setChangePwUser(null)}
          onSubmit={(id, data) => updateMutation.mutateAsync({ id, data })}
          isPending={updateMutation.isPending && updateMutation.variables?.id === changePwUser.id}
        />
      )}

      {/* Modal — oprávnění */}
      {permissionsUser && (
        <PermissionsModal
          user={permissionsUser}
          onClose={() => setPermissionsUser(null)}
          onSave={(id, data) => permsMutation.mutateAsync({ id, data })}
          isPending={permsMutation.isPending}
        />
      )}

      {/* Dialog — potvrzení smazání */}
      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-text mb-2">Smazat uživatele?</h2>
            <p className="text-sm text-muted mb-6">
              Tato akce je nevratná. Uživatel{" "}
              <span className="text-text font-medium">
                {users.find((u) => u.id === deleteConfirm)?.username}
              </span>{" "}
              bude trvale odstraněn.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 px-4 py-2 text-sm rounded-lg border border-border text-muted hover:text-text hover:bg-border transition-colors">
                Zrušit
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="flex-1 px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors font-medium"
              >
                {deleteMutation.isPending ? "Mažu…" : "Smazat"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
