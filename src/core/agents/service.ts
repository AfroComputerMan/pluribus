import { agentRepository } from './repository';
import type { AgentFilter, CreateAgentInput, UpdateAgentInput } from './types';

export class AgentService {
  async getAgent(id: string) {
    return agentRepository.findById(id);
  }

  async listAgents(filter?: AgentFilter & { limit?: number; offset?: number }) {
    return agentRepository.findAll(filter);
  }

  async createAgent(input: CreateAgentInput) {
    return agentRepository.create(input);
  }

  async updateAgent(id: string, input: UpdateAgentInput) {
    return agentRepository.update(id, input);
  }

  async deleteAgent(id: string) {
    return agentRepository.delete(id);
  }

  async getTagStats() {
    return agentRepository.countByTags();
  }

  async getAllTags() {
    return agentRepository.getAllTags();
  }
}

export const agentService = new AgentService();
