import { Card, CardContent } from '@/shared/ui/card';

/** SCR-06 body: the placeholder. The shell enters the workspace of the URL. */
export function WorkspaceHome() {
  return (
    <Card>
      <CardContent>
        <p className="text-muted-foreground">Your inbox arrives here</p>
      </CardContent>
    </Card>
  );
}
