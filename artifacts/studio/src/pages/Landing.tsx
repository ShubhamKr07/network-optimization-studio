import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { CHAPTERS } from "@/lib/chapters";

export function Landing() {
  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-1">Labs</h1>
      <p className="text-muted-foreground mb-6">Pick a chapter to start or continue a scenario.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {CHAPTERS.map((c) => (
          <Link key={c.path} href={c.path} data-testid={`link-${c.path}`}>
            <Card className="cursor-pointer hover:border-primary/50 transition-colors h-full">
              <CardHeader>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{c.chapter}</p>
                <CardTitle className="text-base">{c.title}</CardTitle>
                <CardDescription>{c.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
