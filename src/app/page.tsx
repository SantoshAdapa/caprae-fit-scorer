import { FitScorerApp } from "@/components/FitScorerApp";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center p-8 max-w-5xl mx-auto space-y-6">
      <div className="space-y-2 text-center w-full">
        <h1 className="text-4xl font-bold tracking-tight">
          Acquisition Fit Scorer
        </h1>
        <p className="text-lg text-muted-foreground">
          Rank company domains against a configurable target profile, with
          verified evidence
        </p>
      </div>
      <FitScorerApp />
    </main>
  );
}
