import { CustomAgent } from '../../../types/agent-chat'
import { StrandsAgentOutput, SaveOptions, SaveResult } from './types'
import { CodeGenerator } from './codeGenerator'
import { TOOL_MAPPING } from './toolMapper'
import { promises as fs } from 'fs'
import * as path from 'path'
import os from 'os'
import { createCategoryLogger } from '../../../common/logger'
import {
  buildAllowedOutputDirectories,
  ensureDirectoryWithinAllowed,
  sanitizeFilename
} from '../../../common/security/pathGuards'
import { store } from '../../../preload/store'
import type { ConfigStore } from '../../../preload/store'

const logger = createCategoryLogger('strands-converter')

/**
 * Service to convert Bedrock Engineer's CustomAgent to Strands Agents code
 */
export class StrandsAgentsConverter {
  private codeGenerator: CodeGenerator

  constructor(private readonly configStore: ConfigStore = store) {
    this.codeGenerator = new CodeGenerator()
  }

  private getFilesystemContext(): { projectPath?: string; userDataPath?: string } {
    const projectPathValue = this.configStore.get('projectPath') as string | undefined
    const userDataPathValue = this.configStore.get('userDataPath') as string | undefined

    const projectPath =
      typeof projectPathValue === 'string' && projectPathValue.trim().length > 0
        ? projectPathValue
        : undefined
    const userDataPath =
      typeof userDataPathValue === 'string' && userDataPathValue.trim().length > 0
        ? userDataPathValue
        : undefined

    return { projectPath, userDataPath }
  }

  private getAllowedOutputDirectories(): string[] {
    const { projectPath, userDataPath } = this.getFilesystemContext()

    return buildAllowedOutputDirectories({
      projectPath,
      userDataPath,
      additional: [os.tmpdir()]
    })
  }

  private resolveOutputDirectory(requestedDirectory: string): string {
    const trimmed = requestedDirectory?.trim()
    if (!trimmed) {
      throw new Error('Output directory is required')
    }

    const { projectPath } = this.getFilesystemContext()
    const candidate = path.isAbsolute(trimmed)
      ? trimmed
      : projectPath
      ? path.resolve(projectPath, trimmed)
      : path.resolve(trimmed)

    return ensureDirectoryWithinAllowed(candidate, this.getAllowedOutputDirectories())
  }

  private resolveAgentFilename(fileName?: string): string {
    return sanitizeFilename(fileName, {
      fallback: 'agent',
      allowedExtensions: ['.py']
    })
  }

  /**
   * Convert CustomAgent to Strands Agents Python code
   * @param agent CustomAgent to convert
   * @returns Conversion result
   */
  async convertAgent(agent: CustomAgent): Promise<StrandsAgentOutput> {
    try {
      logger.info(`Converting agent: ${agent.name}`)

      // Input validation
      this.validateAgent(agent)

      // Execute conversion
      const output = this.codeGenerator.generateStrandsAgent(agent)

      logger.info(`Successfully converted agent: ${agent.name}`)
      logger.info(`Supported tools: ${output.toolMapping.supportedTools.length}`)
      logger.info(`Unsupported tools: ${output.toolMapping.unsupportedTools.length}`)

      // MCP server conversion results
      if (output.mcpServerMapping) {
        logger.info(`MCP servers: ${output.mcpServerMapping.servers.length}`)
        output.mcpServerMapping.servers.forEach((server) => {
          logger.info(`  - ${server.original.name}: ${server.original.command}`)
        })
      }

      return output
      } catch (error) {
        logger.error(`Failed to convert agent: ${agent.name}`, { error })
        throw error
      }
  }

  /**
   * Batch convert multiple agents
   * @param agents List of CustomAgent to convert
   * @returns List of conversion results
   */
  async convertMultipleAgents(agents: CustomAgent[]): Promise<
    Array<{
      agent: CustomAgent
      output?: StrandsAgentOutput
      error?: Error
    }>
  > {
    const results: Array<{
      agent: CustomAgent
      output?: StrandsAgentOutput
      error?: Error
    }> = []

    for (const agent of agents) {
      try {
        const output = await this.convertAgent(agent)
        results.push({ agent, output })
      } catch (error) {
        results.push({ agent, error: error as Error })
      }
    }

    return results
  }

  /**
   * Get conversion statistics
   * @param agents List of target CustomAgent
   * @returns Statistics information
   */
  async getConversionStats(agents: CustomAgent[]): Promise<{
    totalAgents: number
    toolsStats: {
      [toolName: string]: {
        supportedCount: number
        unsupportedCount: number
        totalCount: number
      }
    }
    supportedToolsOverall: number
    unsupportedToolsOverall: number
  }> {
    const stats = {
      totalAgents: agents.length,
      toolsStats: {} as Record<
        string,
        {
          supportedCount: number
          unsupportedCount: number
          totalCount: number
        }
      >,
      supportedToolsOverall: 0,
      unsupportedToolsOverall: 0
    }

    for (const agent of agents) {
      try {
        const output = this.codeGenerator.generateStrandsAgent(agent)

        // Supported tools statistics
        output.toolMapping.supportedTools.forEach((tool) => {
          const toolName = tool.originalName
          if (!stats.toolsStats[toolName]) {
            stats.toolsStats[toolName] = { supportedCount: 0, unsupportedCount: 0, totalCount: 0 }
          }
          stats.toolsStats[toolName].supportedCount++
          stats.toolsStats[toolName].totalCount++
          stats.supportedToolsOverall++
        })

        // Unsupported tools statistics
        output.toolMapping.unsupportedTools.forEach((tool) => {
          const toolName = tool.originalName
          if (!stats.toolsStats[toolName]) {
            stats.toolsStats[toolName] = { supportedCount: 0, unsupportedCount: 0, totalCount: 0 }
          }
          stats.toolsStats[toolName].unsupportedCount++
          stats.toolsStats[toolName].totalCount++
          stats.unsupportedToolsOverall++
        })
      } catch (error) {
        logger.warn(`Failed to analyze agent ${agent.name} for stats: ${error}`)
      }
    }

    return stats
  }

  /**
   * Validate agent input
   * @param agent CustomAgent to validate
   */
  private validateAgent(agent: CustomAgent): void {
    if (!agent.name || agent.name.trim() === '') {
      throw new Error('Agent name is required')
    }

    if (!agent.system || agent.system.trim() === '') {
      throw new Error('Agent system prompt is required')
    }

    if (!agent.description) {
      logger.warn(`Agent ${agent.name} has no description`)
    }

    // Tool validity check
    if (agent.tools && agent.tools.length > 0) {
      const uniqueTools = new Set(agent.tools)
      if (uniqueTools.size !== agent.tools.length) {
        logger.warn(`Agent ${agent.name} has duplicate tools`)
      }
    }
  }

  /**
   * Get list of supported tools
   * @returns Array of supported BuiltInToolName
   */
  getSupportedTools(): string[] {
    return Object.entries(TOOL_MAPPING)
      .filter(([, tool]) => tool.supported)
      .map(([toolName]) => toolName)
  }

  /**
   * Get list of unsupported tools
   * @returns Pairs of unsupported BuiltInToolName and reason
   */
  getUnsupportedTools(): Array<{ toolName: string; reason: string }> {
    return Object.entries(TOOL_MAPPING)
      .filter(([, tool]) => !tool.supported)
      .map(([toolName, tool]) => ({
        toolName,
        reason: tool.reason || 'Unknown reason'
      }))
  }

  /**
   * Convert CustomAgent and save as file
   * @param agent CustomAgent to convert
   * @param options Save options
   * @returns Save result
   */
  async convertAndSaveAgent(agent: CustomAgent, options: SaveOptions): Promise<SaveResult> {
    try {
      logger.info(`Converting and saving agent: ${agent.name}`)

      // Execute conversion
      const output = await this.convertAgent(agent)

      // Save file
      return await this.saveAgentToDirectory(output, options)
      } catch (error) {
        logger.error(`Failed to convert and save agent: ${agent.name}`, { error })
        return {
          success: false,
          outputDirectory: options.outputDirectory,
          savedFiles: [],
        errors: [
          {
            file: 'conversion',
            error: error instanceof Error ? error.message : String(error)
          }
        ]
      }
    }
  }

  /**
   * Save converted agent output to directory
   * @param output Conversion result
   * @param options Save options
   * @returns Save result
   */
  async saveAgentToDirectory(
    output: StrandsAgentOutput,
    options: SaveOptions
  ): Promise<SaveResult> {
    const result: SaveResult = {
      success: false,
      outputDirectory: options.outputDirectory,
      savedFiles: [],
      errors: []
    }

    try {
      // Validate save options
      this.validateSaveOptions(options)

      const targetDirectory = this.resolveOutputDirectory(options.outputDirectory)
      const agentFileName = this.resolveAgentFilename(options.agentFileName)

      result.outputDirectory = targetDirectory

      logger.info('Saving agent files', {
        requestedDirectory: options.outputDirectory,
        resolvedDirectory: targetDirectory
      })

      // Create directory
      await fs.mkdir(targetDirectory, { recursive: true, mode: 0o750 })

      // List of files to save
      const filesToSave = [
        {
          name: agentFileName,
          content: output.pythonCode,
          description: 'Python agent code'
        },
        {
          name: 'requirements.txt',
          content: output.requirementsText,
          description: 'Python dependencies'
        },
        {
          name: 'README.md',
          content: output.readmeText,
          description: 'Usage documentation'
        }
      ]

      // When including config.yaml
      if (options.includeConfig === true) {
        filesToSave.push({
          name: 'config.yaml',
          content: output.configYamlText,
          description: 'Agent configuration'
        })
      }

      // Save each file
      for (const file of filesToSave) {
        try {
          const filePath = path.join(targetDirectory, file.name)

          // Overwrite confirmation
          if (!options.overwrite) {
            try {
              await fs.access(filePath)
              // When file exists
              const error = `File already exists: ${file.name} (use overwrite: true to replace)`
              logger.warn(error)
              result.errors?.push({
                file: file.name,
                error
              })
              continue
            } catch {
              // Continue if file doesn't exist
            }
          }

          // File writing
          await fs.writeFile(filePath, file.content, 'utf-8')
          result.savedFiles.push(filePath)
          logger.info(`Saved ${file.description}: ${file.name}`)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          logger.error(`Failed to save ${file.name}: ${errorMessage}`)
          result.errors?.push({
            file: file.name,
            error: errorMessage
          })
        }
      }

      // Success determination
      result.success = result.savedFiles.length > 0 && (result.errors?.length || 0) === 0

      if (result.success) {
        logger.info('Successfully saved Strands agent files', {
          fileCount: result.savedFiles.length,
          outputDirectory: targetDirectory
        })
      } else {
        logger.warn('Partial success saving Strands agent files', {
          saved: result.savedFiles.length,
          errors: result.errors?.length || 0,
          outputDirectory: targetDirectory
        })
      }

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error(`Failed to save agent files: ${errorMessage}`)

      result.errors?.push({
        file: 'directory',
        error: errorMessage
      })

      return result
    }
  }

  /**
   * Validate save options
   * @param options Save options
   */
  private validateSaveOptions(options: SaveOptions): void {
    if (!options.outputDirectory || options.outputDirectory.trim() === '') {
      throw new Error('Output directory is required')
    }

    if (
      options.agentFileName &&
      !options.agentFileName.toLowerCase().endsWith('.py')
    ) {
      throw new Error('Agent file name must end with .py')
    }
  }
}
