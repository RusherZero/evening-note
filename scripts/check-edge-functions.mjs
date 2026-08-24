import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const functionsDirectory = join(process.cwd(), 'supabase', 'functions');

function typescriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

let failed = false;
for (const path of typescriptFiles(functionsDirectory)) {
  const result = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  for (const diagnostic of errors) {
    failed = true;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    console.error(`${path}: ${message}`);
  }
}

if (failed) process.exit(1);
console.log('Edge Function TypeScript syntax is valid.');
