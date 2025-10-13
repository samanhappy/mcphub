import { getMcpSettingsJson } from '../../src/controllers/configController.js'
import * as config from '../../src/config/index.js'
import { Request, Response } from 'express'

// Mock the config module
jest.mock('../../src/config/index.js')

describe('ConfigController - getMcpSettingsJson', () => {
  let mockRequest: Partial<Request>
  let mockResponse: Partial<Response>
  let mockJson: jest.Mock
  let mockStatus: jest.Mock

  beforeEach(() => {
    mockJson = jest.fn()
    mockStatus = jest.fn().mockReturnThis()
    mockRequest = {
      query: {},
    }
    mockResponse = {
      json: mockJson,
      status: mockStatus,
    }

    // Reset mocks
    jest.clearAllMocks()
  })

  describe('Full Settings Export', () => {
    it('should handle settings without users array', () => {
      const mockSettings = {
        mcpServers: {
          'test-server': {
            command: 'test',
            args: ['--test'],
          },
        },
      }

      ;(config.loadOriginalSettings as jest.Mock).mockReturnValue(mockSettings)

      getMcpSettingsJson(mockRequest as Request, mockResponse as Response)

      expect(mockJson).toHaveBeenCalledWith({
        success: true,
        data: {
          mcpServers: mockSettings.mcpServers,
          users: undefined,
        },
      })
    })
  })

  describe('Individual Server Export', () => {
    it('should return individual server configuration when serverName is specified', () => {
      const mockSettings = {
        mcpServers: {
          'test-server': {
            command: 'test',
            args: ['--test'],
            env: {
              TEST_VAR: 'test-value',
            },
          },
          'another-server': {
            command: 'another',
            args: ['--another'],
          },
        },
        users: [
          {
            username: 'admin',
            password: '$2b$10$hashedpassword',
            isAdmin: true,
          },
        ],
      }

      mockRequest.query = { serverName: 'test-server' }
      ;(config.loadOriginalSettings as jest.Mock).mockReturnValue(mockSettings)

      getMcpSettingsJson(mockRequest as Request, mockResponse as Response)

      expect(mockJson).toHaveBeenCalledWith({
        success: true,
        data: {
          mcpServers: {
            'test-server': {
              command: 'test',
              args: ['--test'],
              env: {
                TEST_VAR: 'test-value',
              },
            },
          },
        },
      })
    })

    it('should return 404 when server does not exist', () => {
      const mockSettings = {
        mcpServers: {
          'test-server': {
            command: 'test',
            args: ['--test'],
          },
        },
      }

      mockRequest.query = { serverName: 'non-existent-server' }
      ;(config.loadOriginalSettings as jest.Mock).mockReturnValue(mockSettings)

      getMcpSettingsJson(mockRequest as Request, mockResponse as Response)

      expect(mockStatus).toHaveBeenCalledWith(404)
      expect(mockJson).toHaveBeenCalledWith({
        success: false,
        message: "Server 'non-existent-server' not found",
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle errors gracefully and return 500', () => {
      const errorMessage = 'Failed to load settings'
      ;(config.loadOriginalSettings as jest.Mock).mockImplementation(() => {
        throw new Error(errorMessage)
      })

      getMcpSettingsJson(mockRequest as Request, mockResponse as Response)

      expect(mockStatus).toHaveBeenCalledWith(500)
      expect(mockJson).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to get MCP settings',
      })
    })
  })
})
