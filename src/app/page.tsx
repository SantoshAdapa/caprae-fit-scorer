import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Acquisition Fit Scorer</h1>
      <p className="text-lg text-muted-foreground">
        Rank company domains against a configurable target profile, with
        verified evidence
      </p>
      <Alert className="max-w-md">
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>Work in progress</AlertDescription>
      </Alert>
      <Button>Get Started</Button>
    </main>
  );
}
