import { Code2, FileCode2, FileText, FolderKanban, Globe, HardDrive, Library, ListTodo, Sigma, Workflow, type LucideIcon } from 'lucide-react';

/** Icons and labels for knowledge source types, shared by the assistant and the knowledge page. */
export const SOURCE_ICONS: Record<string, LucideIcon> = { project: FolderKanban, task: ListTodo, document: FileText, latex: Sigma, 'code-file': FileCode2, 'code-project': Code2, file: HardDrive, architecture: Workflow, preview: Globe, workspace: Library };
export const SOURCE_LABELS: Record<string, string> = { project: 'Project', task: 'Task', document: 'Document', latex: 'LaTeX', 'code-file': 'Code', 'code-project': 'Code project', file: 'Drive', architecture: 'Architecture', preview: 'Preview', workspace: 'Workspace' };
