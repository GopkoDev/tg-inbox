import { Card, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

export function HomePage() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1>tg-inbox</h1>
          </CardTitle>
          <CardDescription>Shared Telegram inbox for your business bot.</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
