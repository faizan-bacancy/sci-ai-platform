"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ImportSummaryCard({
  processed,
  inserted,
  updated,
  errors,
  onDownloadErrors,
}: {
  processed: number;
  inserted: number;
  updated: number;
  errors: number;
  onDownloadErrors?: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Processed</div>
            <div className="text-lg font-semibold">{processed}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Inserted</div>
            <div className="text-lg font-semibold">{inserted}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Updated</div>
            <div className="text-lg font-semibold">{updated}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Errors</div>
            <div className="text-lg font-semibold">{errors}</div>
          </div>
        </div>
        {onDownloadErrors ? (
          <div className="mt-4">
            <Button variant="secondary" onClick={onDownloadErrors}>
              Download error report
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
