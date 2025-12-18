// API клиент для работы с agent tasks

export interface AgentTask {
  id: number;
  type: string;
  params: string | null;
  status: string;
  createdAt: string;
}

const API_BASE = '/api/agent/tasks';

export async function getPendingAgentTasks(): Promise<AgentTask[]> {
  try {
    const response = await fetch(`${API_BASE}/pending`);

    if (!response.ok) {
      throw new Error(`Failed to fetch pending tasks: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching pending agent tasks:', error);
    return [];
  }
}

export async function completeAgentTask(taskId: number): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/${taskId}/complete`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Failed to complete task: ${response.statusText}`);
    }

    const result = await response.json();
    return result.success === true;
  } catch (error) {
    console.error('Error completing agent task:', error);
    return false;
  }
}

export async function failAgentTask(
  taskId: number,
  errorMessage: string
): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/${taskId}/fail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: errorMessage,
    });

    if (!response.ok) {
      throw new Error(`Failed to mark task as failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result.success === true;
  } catch (error) {
    console.error('Error marking agent task as failed:', error);
    return false;
  }
}
