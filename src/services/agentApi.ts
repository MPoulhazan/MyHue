import axios from 'axios';

export type AgentRole = 'user' | 'assistant';

export interface AgentMessage {
    role: AgentRole;
    content: string;
}

export interface AgentActionResult {
    action: Record<string, unknown>;
    status: 'ok' | 'error' | 'ignored';
    error?: string;
}

export interface AgentResponse {
    message: string;
    actions: Record<string, unknown>[];
    actionResults: AgentActionResult[];
    model?: string;
    error?: string;
}

export const agentApi = {
    async sendMessage(
        message: string,
        history: AgentMessage[],
    ): Promise<AgentResponse> {
        const response = await axios.post<AgentResponse>('/api/agent', {
            message,
            history,
        });

        return response.data;
    },

    async getStatus() {
        const response = await axios.get('/api/agent/status');
        return response.data as {
            ok: boolean;
            hueConfigured: boolean;
            ollamaOk: boolean;
            model: string;
            ollamaUrl: string;
        };
    },
};
