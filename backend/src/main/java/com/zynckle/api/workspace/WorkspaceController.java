package com.zynckle.api.workspace;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class WorkspaceController {
    private final JdbcTemplate jdbc;
    public WorkspaceController(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @GetMapping("/projects")
    public List<Map<String,Object>> projects() {
        return jdbc.queryForList("""
            SELECT id, name, description, status, due_date AS due, created_at, updated_at
            FROM project ORDER BY updated_at DESC LIMIT 100
            """);
    }
    @GetMapping("/tasks")
    public List<Map<String,Object>> allTasks(){return jdbc.queryForList("SELECT t.id,t.project_id,t.title,t.description,t.status,t.priority,t.due_date AS due,p.name AS project FROM task t JOIN project p ON p.id=t.project_id ORDER BY t.created_at DESC LIMIT 500");}
    @PostMapping("/projects")
    public Map<String,Object> createProject(@Valid @RequestBody ProjectInput input) {
        UUID user = UUID.fromString("00000000-0000-0000-0000-000000000001");
        UUID workspace = UUID.fromString("00000000-0000-0000-0000-000000000001");
        return jdbc.queryForMap("""
            INSERT INTO project(workspace_id,name,description,created_by)
            VALUES (?,?,?,?) RETURNING id,name,description,status,due_date AS due,created_at,updated_at
            """, workspace, input.name().trim(), input.description() == null ? "" : input.description().trim(), user);
    }
    @GetMapping("/projects/{projectId}/tasks")
    public List<Map<String,Object>> tasks(@PathVariable UUID projectId) {
        return jdbc.queryForList("SELECT id,project_id,title,description,status,priority,due_date AS due,position FROM task WHERE project_id=? ORDER BY status,position LIMIT 500", projectId);
    }
    @PostMapping("/projects/{projectId}/tasks")
    public Map<String,Object> createTask(@PathVariable UUID projectId,@Valid @RequestBody TaskInput input) {
        return jdbc.queryForMap("INSERT INTO task(project_id,title,description,priority) VALUES (?,?,?,?) RETURNING id,project_id,title,description,status,priority,due_date AS due,position",
            projectId,input.title().trim(),input.description()==null?"":input.description().trim(),input.priority()==null?"NORMAL":input.priority());
    }
    @PatchMapping("/tasks/{taskId}")
    public Map<String,Object> updateTask(@PathVariable UUID taskId,@RequestBody TaskUpdate input) {
        return jdbc.queryForMap("UPDATE task SET status=COALESCE(?,status),priority=COALESCE(?,priority),updated_at=now() WHERE id=? RETURNING id,project_id,title,description,status,priority,due_date AS due,position",input.status(),input.priority(),taskId);
    }
    @DeleteMapping("/tasks/{taskId}")
    public Map<String,Object> deleteTask(@PathVariable UUID taskId){jdbc.update("DELETE FROM task WHERE id=?",taskId);return Map.of("deleted",true);}
    @GetMapping("/documents")
    public List<Map<String,Object>> documents(){return jdbc.queryForList("SELECT id,title,content,updated_at FROM document ORDER BY updated_at DESC LIMIT 200");}
    @PostMapping("/documents")
    public Map<String,Object> saveDocument(@RequestBody DocumentInput input){UUID id=input.id()==null?UUID.randomUUID():input.id();jdbc.update("MERGE INTO document(id,workspace_id,title,content,owner_id,updated_at) KEY(id) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)",id,UUID.fromString("00000000-0000-0000-0000-000000000001"),input.title(),input.content(),UUID.fromString("00000000-0000-0000-0000-000000000001"));return jdbc.queryForMap("SELECT id,title,content,updated_at FROM document WHERE id=?",id);}
    @DeleteMapping("/documents/{id}")
    public Map<String,Object> deleteDocument(@PathVariable UUID id){jdbc.update("DELETE FROM document WHERE id=?",id);return Map.of("deleted",true);}
    public record ProjectInput(@NotBlank @Size(max=160) String name,@Size(max=2000) String description) {}
    public record TaskInput(@NotBlank @Size(max=240) String title,@Size(max=4000) String description,String priority) {}
    public record TaskUpdate(String status,String priority) {}
    public record DocumentInput(UUID id,@NotBlank @Size(max=240) String title,@Size(max=500000) String content){}
}
