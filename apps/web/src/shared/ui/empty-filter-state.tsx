import { Button } from '@/shared/ui/button';

function EmptyFilterState({ message, onClear }: { message: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}

export { EmptyFilterState };
