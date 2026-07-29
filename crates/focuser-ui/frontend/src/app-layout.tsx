import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core"; // Calls our secure Rust password commands
import { listen } from "@tauri-apps/api/event"; // Listens for tauri events (like the quit menu request)
import {
  AppWindow,
  BarChart3,
  CalendarClock,
  Globe,
  Hourglass,
  LayoutDashboard,
  ListChecks,
  Settings,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { BlockingHealthBanner } from "@/components/blocking-health-banner";
import { TitleBar } from "@/components/title-bar";
import { AppIcon } from "@/components/ui/app-icon";
import { LiveBadge } from "@/components/ui/badge";
import { UpdatePill } from "@/components/update-pill";
import { usePomodoroStatus } from "@/lib/commands";
import { formatCountdown } from "@/lib/duration";
import { useApplySavedLanguage } from "@/lib/language";
import { cn } from "@/lib/utils";
import { m } from "@/paraglide/messages.js";

const NAV = [
  { to: "/", label: m.nav_dashboard, icon: LayoutDashboard, end: true },
  { to: "/block-lists", label: m.nav_block_lists, icon: ListChecks },
  { to: "/websites", label: m.nav_websites, icon: Globe },
  { to: "/apps", label: m.nav_applications, icon: AppWindow },
  { to: "/schedule", label: m.nav_schedule, icon: CalendarClock },
  { to: "/allowances", label: m.nav_allowances, icon: Hourglass },
  { to: "/statistics", label: m.nav_statistics, icon: BarChart3 },
  { to: "/settings", label: m.nav_settings, icon: Settings },
] as const;

export function AppLayout() {
  useApplySavedLanguage();

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [error, setError] = useState("");

  // System Tray Quit States
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [quitPasswordInput, setQuitPasswordInput] = useState("");
  const [quitError, setQuitError] = useState("");

  // Check backend file on mount to see if a password exists
  useEffect(() => {
    async function checkPasswordStatus() {
      const hasPwd = await invoke<boolean>("check_has_password");
      setHasPassword(hasPwd);
      setIsUnlocked(!hasPwd); // If no password exists, unlock immediately
    }
    checkPasswordStatus();
  }, []);

  // Re-lock when the window is re-shown from tray
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function listenWindowFocus() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();

      unlisten = await appWindow.onFocusChanged(async ({ payload: focused }) => {
        if (focused) {
          const hasPwd = await invoke<boolean>("check_has_password");
          if (hasPwd) {
            setIsUnlocked(false);
            setPasswordInput("");
            setError("");
          }
          setHasPassword(hasPwd);
        }
      });
    }

    listenWindowFocus();

    return () => {
      unlisten?.();
    };
  }, []);

  // Listen for Tray "Quit" menu clicks
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen("tray-quit-requested", async () => {
        const hasPwd = await invoke<boolean>("check_has_password");
        if (!hasPwd) {
          // If no password exists, close instantly
          invoke("exit_app");
        } else {
          // If a password exists, open the verification modal
          setShowQuitModal(true);
        }
      });
    };

    setupListener();

    return () => {
      unlisten?.();
    };
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const isValid = await invoke<boolean>("verify_app_password", { password: passwordInput });
    if (isValid) {
      setIsUnlocked(true);
      setError("");
      setPasswordInput("");
    } else {
      setError("Incorrect password. Please try again.");
    }
  };

  const handleQuitConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    const isValid = await invoke<boolean>("verify_app_password", { password: quitPasswordInput });
    if (isValid) {
      invoke("exit_app");
    } else {
      setQuitError("Incorrect password. Request denied.");
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-deep">
      <TitleBar />

      <div className="flex min-h-0 flex-1">
        {!isUnlocked ? (
          <div className="flex flex-1 flex-col items-center justify-center p-6 bg-background">
            <div className="glass w-full max-w-sm rounded-xl border border-border/60 p-6 shadow-xl text-center space-y-4">
              <AppIcon className="size-12 mx-auto rounded-xl" />
              <h2 className="text-xl font-bold tracking-tight text-foreground">Focuser is Locked</h2>

              {hasPassword ? (
                <>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    App blocking is active in the background. Enter your password to continue.
                  </p>
                  <form onSubmit={handleUnlock} className="space-y-3 pt-2">
                    <input
                      type="password"
                      placeholder="Enter Password"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      className="w-full rounded-lg border border-border/60 bg-foreground/[0.02] px-3 py-2 text-foreground text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      autoFocus
                    />
                    {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
                    <button
                      type="submit"
                      className="w-full rounded-lg bg-primary py-2 font-semibold text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Unlock App
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Set a password to protect your settings, or skip to enter without one.
                  </p>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const val = passwordInput.trim();
                      if (val.length === 0) {
                        setIsUnlocked(true);
                      } else if (val.length < 4) {
                        setError("Password must be at least 4 characters.");
                      } else {
                        // Securely hash and save password to backend disk file
                        await invoke("set_app_password", { password: val });
                        setHasPassword(true);
                        setIsUnlocked(true);
                        setError("");
                      }
                    }}
                    className="space-y-3 pt-2"
                  >
                    <input
                      type="password"
                      placeholder="Set a password (optional)"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      className="w-full rounded-lg border border-border/60 bg-foreground/[0.02] px-3 py-2 text-foreground text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      autoFocus
                    />
                    {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
                    <button
                      type="submit"
                      className="w-full rounded-lg bg-primary py-2 font-semibold text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      {passwordInput.trim().length === 0 ? "Enter Without Password" : "Set Password & Unlock"}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            <Sidebar hasPassword={hasPassword} />
            <main className="app-canvas min-w-0 flex-1 overflow-y-auto bg-background">
              <BlockingHealthBanner />
              <Outlet />
            </main>
          </>
        )}
      </div>

      {/* 🛑 Tray Quit Password Verification Modal Overlay */}
      {showQuitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="glass w-full max-w-sm rounded-xl border border-border/60 p-6 shadow-xl text-center space-y-4">
            <h2 className="text-xl font-bold tracking-tight text-foreground">Quit Focuser</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Shutting down Focuser will disable all active blocking sessions. A password is required to exit.
            </p>
            
            <form onSubmit={handleQuitConfirm} className="space-y-3 pt-2">
              <input
                type="password"
                placeholder="Enter Password to Quit"
                value={quitPasswordInput}
                onChange={(e) => setQuitPasswordInput(e.target.value)}
                className="w-full rounded-lg border border-border/60 bg-foreground/[0.02] px-3 py-2 text-foreground text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
              {quitError && <p className="text-xs text-red-500 font-medium">{quitError}</p>}
              
              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowQuitModal(false);
                    setQuitPasswordInput("");
                    setQuitError("");
                  }}
                  className="flex-1 rounded-lg border border-border/60 py-2 font-semibold text-sm text-foreground hover:bg-foreground/[0.04] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-red-600 py-2 font-semibold text-sm text-white hover:bg-red-500 transition-colors"
                >
                  Quit App
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Sidebar({ hasPassword }: { hasPassword: boolean }) {
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  return (
    <nav
      aria-label={m.nav_landmark()}
      className="glass flex w-56 shrink-0 flex-col border-border/60 border-r p-3"
    >
      <Brand />

      <div className="flex flex-col gap-0.5">
        {NAV.map(({ to, label, icon: Icon, ...rest }) => (
          <NavLink
            key={to}
            to={to}
            end={"end" in rest ? rest.end : undefined}
            className={({ isActive }) =>
              cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 font-medium text-sm",
                "transition-colors duration-150",
                isActive
                  ? "bg-primary/12 text-foreground"
                  : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  aria-hidden
                  className={cn(
                    "-translate-y-1/2 absolute top-1/2 left-0 w-[3px] rounded-r-full bg-primary",
                    "transition-all duration-200",
                    isActive ? "h-5 opacity-100" : "h-0 opacity-0",
                  )}
                />
                <Icon
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0 transition-colors",
                    isActive ? "text-primary" : "text-faint-foreground group-hover:text-foreground",
                  )}
                />
                {label()}
              </>
            )}
          </NavLink>
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-2 pt-3">
        {/* Render setup input if no password exists */}
        {!hasPassword ? (
          <div className="rounded-lg border border-border/40 p-2.5 text-center space-y-1.5 bg-foreground/[0.01]">
            <p className="text-[11px] text-muted-foreground leading-normal">
              Protect settings with password:
            </p>
            <input
              type="password"
              placeholder="Type password & press Enter"
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  const val = (e.target as HTMLInputElement).value;
                  if (val.trim().length >= 4) {
                    await invoke("set_app_password", { password: val });
                    window.location.reload();
                  } else {
                    alert("Password must be at least 4 characters long.");
                  }
                }
              }}
              className="w-full rounded bg-foreground/[0.04] border border-border/40 px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        ) : isChangingPassword ? (
          /* Render inline edit input if Changing Password is active */
          <div className="rounded-lg border border-border/40 p-2.5 text-center space-y-1.5 bg-foreground/[0.01]">
            <p className="text-[11px] text-muted-foreground leading-normal">
              Enter new password:
            </p>
            <input
              type="password"
              placeholder="New password & press Enter"
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  const val = (e.target as HTMLInputElement).value;
                  if (val.trim().length >= 4) {
                    await invoke("set_app_password", { password: val });
                    setIsChangingPassword(false);
                    alert("Password updated successfully!");
                  } else {
                    alert("Password must be at least 4 characters long.");
                  }
                }
              }}
              className="w-full rounded bg-foreground/[0.04] border border-border/40 px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
            <button
              onClick={() => setIsChangingPassword(false)}
              className="text-[10px] text-muted-foreground hover:text-foreground underline transition-colors block mx-auto pt-0.5"
            >
              Cancel
            </button>
          </div>
        ) : (
          /* Render Change Password button */
          <button
            onClick={() => setIsChangingPassword(true)}
            className="flex items-center justify-center gap-2 rounded-lg border border-border/60 px-3 py-2 font-medium text-sm text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground transition-colors"
          >
            Change Password
          </button>
        )}
        <UpdatePill />
        <SessionPill />
      </div>
    </nav>
  );
}

function Brand() {
  return (
    <div className="mb-5 flex items-center gap-2.5 px-2 py-3">
      <AppIcon className="size-8 rounded-lg" />
      <span className="font-semibold text-base text-foreground tracking-tight">Focuser</span>
    </div>
  );
}

function SessionPill() {
  const status = usePomodoroStatus();
  if (!status.data) return null;

  const phase = status.data.current_phase === "work" ? m.session_focus() : m.session_break();

  return (
    <div className="glass-strong rounded-lg border border-primary/25 p-3">
      <div className="flex items-center justify-between gap-2">
        <LiveBadge tone={status.data.current_phase === "work" ? "primary" : "success"}>
          {status.data.paused ? m.session_paused() : phase}
        </LiveBadge>
        <span className="font-semibold text-foreground text-sm tabular-nums">
          {formatCountdown(status.data.remaining_secs)}
        </span>
      </div>
      <p className="mt-1.5 truncate text-faint-foreground text-xs">{status.data.block_list_name}</p>
    </div>
  );
}