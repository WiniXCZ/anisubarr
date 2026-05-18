import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Trash2, Shield, ShieldOff, UserCheck, UserX, X, Eye, EyeOff } from "lucide-react";
import { getMe, getUsers, createUser, updateUser, deleteUser } from "../api/client";
import clsx from "clsx";

// ── Toggle přepínač ───────────────────────

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

// ── Modal pro přidání uživatele ───────────

function AddUserModal({ onClose, onSubmit, isPending }) {
  const [form, setForm]         = useState({ username: "", password: "", email: "", is_admin: false });
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
        is_admin: form.is_admin,
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
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted hover:text-text hover:bg-border transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username */}
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

          {/* Heslo */}
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

          {/* Email */}
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

          {/* Is admin */}
          <div className="flex items-center justify-between py-1">
            <span className="text-sm font-medium text-muted">Administrátor</span>
            <Toggle checked={form.is_admin} onChange={(v) => set("is_admin", v)} />
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

// ── Modal změna hesla ─────────────────────

function ChangePasswordModal({ user, onClose, onSubmit, isPending }) {
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!password.trim()) {
      setError("Heslo nesmí být prázdné.");
      return;
    }
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

// ── Hlavní stránka ────────────────────────

export default function AdminUsers() {
  const navigate     = useNavigate();
  const queryClient  = useQueryClient();

  const [showAddModal,  setShowAddModal]  = useState(false);
  const [changePwUser,  setChangePwUser]  = useState(null);   // User objekt pro změnu hesla
  const [deleteConfirm, setDeleteConfirm] = useState(null);   // id uživatele ke smazání

  // Načtení aktuálního uživatele pro admin guard a self-check
  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["me"],
    queryFn:  () => getMe().then((r) => r.data),
  });

  // Redirect pokud není admin
  if (!meLoading && me && !me.is_admin) {
    navigate("/", { replace: true });
    return null;
  }

  // Načtení seznamu uživatelů
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn:  () => getUsers().then((r) => r.data),
    enabled:  !!me?.is_admin,
  });

  // Mutace
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

  function handleToggle(user, field) {
    updateMutation.mutate({ id: user.id, data: { [field]: !user[field] } });
  }

  // Loading state
  if (meLoading || (!me && !meLoading)) {
    return (
      <div className="flex items-center justify-center py-24 text-muted text-sm">
        Načítám…
      </div>
    );
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
                <th className="text-center text-xs font-medium text-muted px-4 py-3 uppercase tracking-wide">Admin</th>
                <th className="text-center text-xs font-medium text-muted px-4 py-3 uppercase tracking-wide">Aktivní</th>
                <th className="text-right text-xs font-medium text-muted px-4 py-3 uppercase tracking-wide">Akce</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((user) => {
                const isSelf      = user.id === me?.id;
                const isUpdating  = updateMutation.isPending;

                return (
                  <tr
                    key={user.id}
                    className={clsx(
                      "transition-colors hover:bg-bg/40",
                      !user.is_active && "opacity-50"
                    )}
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

                    {/* is_admin toggle */}
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center" title={isSelf ? "Nemůžeš odebrat sám sobě admin práva" : undefined}>
                        <Toggle
                          checked={user.is_admin}
                          onChange={() => handleToggle(user, "is_admin")}
                          disabled={isUpdating || isSelf}
                        />
                      </div>
                    </td>

                    {/* is_active toggle */}
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center" title={isSelf ? "Nemůžeš deaktivovat vlastní účet" : undefined}>
                        <Toggle
                          checked={user.is_active}
                          onChange={() => handleToggle(user, "is_active")}
                          disabled={isUpdating || isSelf}
                        />
                      </div>
                    </td>

                    {/* Akce */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* Změna hesla */}
                        <button
                          onClick={() => setChangePwUser(user)}
                          title="Změnit heslo"
                          className="p-1.5 rounded-md text-muted hover:text-text hover:bg-border transition-colors"
                        >
                          <Shield size={14} />
                        </button>

                        {/* Smazat */}
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
          isPending={updateMutation.isPending}
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
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 text-sm rounded-lg border border-border text-muted hover:text-text hover:bg-border transition-colors"
              >
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
