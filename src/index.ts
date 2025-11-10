// src/index.ts - Unified HTTP + MCP Server
import express from 'express';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Shared data store
interface Task {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
}



const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TASKS_FILE = path.join(__dirname, 'tasks.json');
// const TASKS_FILE = path.join(process.cwd(), 'tasks.json');

// Helper functions for file-based storage
function loadTasks(): Task[] {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const data = fs.readFileSync(TASKS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading tasks:', error);
  }
  return [];
}

function saveTasks(tasks: Task[]): void {
  try {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving tasks:', error);
  }
}

// Task API logic (shared between HTTP and MCP)
const taskAPI = {
  createTask(title: string): Task {
    const tasks = loadTasks();
    const task: Task = {
      id: Date.now().toString(),
      title,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    tasks.push(task);
    saveTasks(tasks);
    return task;
  },

  listTasks(): Task[] {
    return loadTasks();
  },

  getTask(id: string): Task | undefined {
    const tasks = loadTasks();
    return tasks.find((t: Task) => t.id === id);
  },

  completeTask(id: string): Task | null {
    const tasks = loadTasks();
    const task = tasks.find((t: Task) => t.id === id);
    if (!task) return null;
    task.completed = true;
    saveTasks(tasks);
    return task;
  },

  deleteTask(id: string): Task | null {
    const tasks = loadTasks();
    const index = tasks.findIndex((t: Task) => t.id === id);
    if (index === -1) return null;
    const deleted = tasks.splice(index, 1)[0];
    saveTasks(tasks);
    return deleted;
  }
};

// ============================================
// HTTP REST API Server
// ============================================
function startHttpServer() {
  const app = express();
  app.use(express.json());

  // GET /tasks - List all tasks
  app.get('/tasks', (req, res) => {
    const allTasks = taskAPI.listTasks();
    res.json({
      success: true,
      data: allTasks,
      count: allTasks.length
    });
  });

  // POST /tasks - Create a new task
  app.post('/tasks', (req, res) => {
    const { title } = req.body;
    
    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'Title is required'
      });
    }

    const task = taskAPI.createTask(title);
    
    res.status(201).json({
      success: true,
      data: task
    });
  });

  // GET /tasks/:id - Get a single task
  app.get('/tasks/:id', (req, res) => {
    const task = taskAPI.getTask(req.params.id);
    
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }
    
    res.json({
      success: true,
      data: task
    });
  });

  // PATCH /tasks/:id/complete - Mark task as completed
  app.patch('/tasks/:id/complete', (req, res) => {
    const task = taskAPI.completeTask(req.params.id);
    
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }
    
    res.json({
      success: true,
      data: task
    });
  });

  // DELETE /tasks/:id - Delete a task
  app.delete('/tasks/:id', (req, res) => {
    const deleted = taskAPI.deleteTask(req.params.id);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }
    
    res.json({
      success: true,
      data: deleted
    });
  });

  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.error(`HTTP REST API server running on http://localhost:${PORT}`);
    console.error(`
Available endpoints:
  GET    /tasks              - List all tasks
  POST   /tasks              - Create a task
  GET    /tasks/:id          - Get a single task
  PATCH  /tasks/:id/complete - Mark task as completed
  DELETE /tasks/:id          - Delete a task
    `);
  });
}

// ============================================
// MCP Server (for Claude Desktop)
// ============================================
async function startMCPServer() {
  const server = new Server(
    {
      name: "simple-task-api",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "create_task",
          description: "Create a new task",
          inputSchema: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "The title of the task",
              },
            },
            required: ["title"],
          },
        },
        {
          name: "list_tasks",
          description: "List all tasks",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "get_task",
          description: "Get a single task by ID",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "The ID of the task",
              },
            },
            required: ["id"],
          },
        },
        {
          name: "complete_task",
          description: "Mark a task as completed",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "The ID of the task to complete",
              },
            },
            required: ["id"],
          },
        },
        {
          name: "delete_task",
          description: "Delete a task",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "The ID of the task to delete",
              },
            },
            required: ["id"],
          },
        },
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!args) {
      return {
        content: [
          {
            type: "text",
            text: "No arguments provided",
          },
        ],
        isError: true,
      };
    }

    try {
      switch (name) {
        case "create_task": {
          const task = taskAPI.createTask(args.title as string);
          return {
            content: [
              {
                type: "text",
                text: `Task created successfully:\n${JSON.stringify(task, null, 2)}`,
              },
            ],
          };
        }

        case "list_tasks": {
          const allTasks = taskAPI.listTasks();
          return {
            content: [
              {
                type: "text",
                text: allTasks.length > 0
                  ? `Found ${allTasks.length} tasks:\n${JSON.stringify(allTasks, null, 2)}`
                  : "No tasks found",
              },
            ],
          };
        }

        case "get_task": {
          const task = taskAPI.getTask(args.id as string);
          if (!task) {
            return {
              content: [
                {
                  type: "text",
                  text: `Task with ID ${args.id} not found`,
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(task, null, 2),
              },
            ],
          };
        }

        case "complete_task": {
          const task = taskAPI.completeTask(args.id as string);
          if (!task) {
            return {
              content: [
                {
                  type: "text",
                  text: `Task with ID ${args.id} not found`,
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: "text",
                text: `Task completed:\n${JSON.stringify(task, null, 2)}`,
              },
            ],
          };
        }

        case "delete_task": {
          const deleted = taskAPI.deleteTask(args.id as string);
          if (!deleted) {
            return {
              content: [
                {
                  type: "text",
                  text: `Task with ID ${args.id} not found`,
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: "text",
                text: `Task deleted:\n${JSON.stringify(deleted, null, 2)}`,
              },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: "text",
                text: `Unknown tool: ${name}`,
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ============================================
// Start the appropriate server based on args
// ============================================
const mode = process.argv[2];

if (mode === '--http') {
  // Start HTTP server only
  startHttpServer();
} else if (mode === '--mcp') {
  // Start MCP server only (for Claude Desktop)
  startMCPServer();
} else {
  // Default: Start both servers
  startHttpServer();
  startMCPServer();
}