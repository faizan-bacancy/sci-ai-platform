"use client";

import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { cn } from "@/lib/utils";
import { UploadCloud } from "lucide-react";

export function FileDropzone({
  onFileAccepted,
  error,
  maxSize = 10 * 1024 * 1024,
  className,
}: {
  onFileAccepted: (file: File) => void;
  error?: string | null;
  maxSize?: number;
  className?: string;
}) {
  const [dropError, setDropError] = useState<string | null>(null);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: false,
    maxSize,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "text/csv": [".csv"],
    },
    onDropAccepted: (files) => {
      setDropError(null);
      if (files[0]) onFileAccepted(files[0]);
    },
    onDropRejected: (rejections) => {
      const first = rejections[0]?.errors?.[0];
      if (!first) {
        setDropError("Unable to process the selected file.");
        return;
      }
      if (first.code === "file-too-large") {
        setDropError("File is too large. Max size is 10MB.");
        return;
      }
      if (first.code === "file-invalid-type") {
        setDropError("Only .xlsx and .csv files are supported.");
        return;
      }
      setDropError(first.message);
    },
  });

  return (
    <div className={cn("space-y-2", className)}>
      <div
        {...getRootProps()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center text-sm transition-colors",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/30 hover:border-muted-foreground/60",
        )}
      >
        <input {...getInputProps()} />
        <UploadCloud className="h-6 w-6 text-muted-foreground" />
        <div className="font-medium">Drop Excel or CSV here</div>
        <div className="text-xs text-muted-foreground">.xlsx or .csv · Max 10MB · Click to browse</div>
      </div>
      {error || dropError ? <div className="text-xs text-destructive">{error ?? dropError}</div> : null}
    </div>
  );
}
