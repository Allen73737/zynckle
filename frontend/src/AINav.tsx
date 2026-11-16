import { NavLink } from 'react-router-dom';
import { MessagesSquare, Workflow, Wand2 } from 'lucide-react';

/** Section tabs shared by the AI pages. */
export default function AINav() {
  return <nav className="zy-tabs" aria-label="Zynckle AI sections">
    <NavLink to="/ai" end className={({ isActive }) => isActive ? 'active' : ''}><MessagesSquare size={16}/> Assistant</NavLink>
    <NavLink to="/ai/architecture" className={({ isActive }) => isActive ? 'active' : ''}><Workflow size={16}/> Architecture designer</NavLink>
    <NavLink to="/ai/workshop" className={({ isActive }) => isActive ? 'active' : ''}><Wand2 size={16}/> Docs & planning workshop</NavLink>
  </nav>;
}
