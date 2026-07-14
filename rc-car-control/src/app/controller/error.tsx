"use client";

import { useEffect } from "react";

export default function ControllerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
      <section className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Controller Error</p>
        <h1 className="mt-3 text-2xl font-semibold">Unable to load controller</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          The controller page hit an unexpected error. You can retry the page state
          or reload the browser to recover.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-2xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Reload Page
          </button>
        </div>

        {error.digest && (
          <p className="mt-5 text-xs text-slate-500">Digest: {error.digest}</p>
        )}
      </section>
    </main>
  );
}