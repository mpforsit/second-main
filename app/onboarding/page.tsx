// Placeholder. The real onboarding interview lands in Step 4
// (docs/07-phase-1-buildplan.md). Middleware already protects this route.

export default function OnboardingPage() {
  return (
    <main className="flex min-h-svh flex-1 flex-col items-center justify-center gap-3 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Onboarding</h1>
      <p className="text-muted-foreground max-w-md text-center text-sm">
        The cold-start interview will be implemented in Step 4. For now this route exists so
        middleware-level protection can be verified.
      </p>
    </main>
  );
}
