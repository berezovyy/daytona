/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ObjectStorageApi,
  SnapshotDto,
  SnapshotsApi,
  SnapshotState,
  CreateSnapshot,
  Configuration,
  SandboxApi,
  PaginatedSnapshots as PaginatedSnapshotsDto,
} from '@daytonaio/api-client'
import { DaytonaError } from './errors/DaytonaError'
import { Image } from './Image'
import { Resources } from './Daytona'
import { Sandbox } from './Sandbox'
import { processStreamingResponse } from './utils/Stream'
import { dynamicImport } from './utils/Import'
import { WithInstrumentation } from './utils/otel.decorator'

/**
 * Represents a Daytona Snapshot which is a pre-configured sandbox.
 *
 * @property {string} id - Unique identifier for the Snapshot.
 * @property {string} organizationId - Organization ID that owns the Snapshot.
 * @property {boolean} general - Whether the Snapshot is general.
 * @property {string} name - Name of the Snapshot.
 * @property {string} imageName - Name of the Image of the Snapshot.
 * @property {SnapshotState} state - Current state of the Snapshot.
 * @property {number} size - Size of the Snapshot.
 * @property {string[]} entrypoint - Entrypoint of the Snapshot.
 * @property {number} cpu - CPU of the Snapshot.
 * @property {number} gpu - GPU of the Snapshot.
 * @property {number} mem - Memory of the Snapshot in GiB.
 * @property {number} disk - Disk of the Snapshot in GiB.
 * @property {string} errorReason - Error reason of the Snapshot.
 * @property {Date} createdAt - Timestamp when the Snapshot was created.
 * @property {Date} updatedAt - Timestamp when the Snapshot was last updated.
 * @property {Date} lastUsedAt - Timestamp when the Snapshot was last used.
 */
export type Snapshot = SnapshotDto & { __brand: 'Snapshot' }

/**
 * Represents a paginated list of Daytona Snapshots.
 *
 * @property {Snapshot[]} items - List of Snapshot instances in the current page.
 * @property {number} total - Total number of Snapshots across all pages.
 * @property {number} page - Current page number.
 * @property {number} totalPages - Total number of pages available.
 */
export interface PaginatedSnapshots extends Omit<PaginatedSnapshotsDto, 'items'> {
  items: Snapshot[]
}

/**
 * Parameters for creating a new snapshot.
 *
 * @property {string} name - Name of the snapshot.
 * @property {string | Image} image - Image of the snapshot. If a string is provided, it should be available on some registry.
 * If an Image instance is provided, it will be used to create a new image in Daytona.
 * @property {Resources} resources - Resources of the snapshot.
 * @property {string[]} entrypoint - Entrypoint of the snapshot.
 * @property {string} regionId - ID of the region where the snapshot will be available. Defaults to organization default region if not specified.
 */
export type CreateSnapshotParams = {
  name: string
  image: string | Image
  resources?: Resources
  entrypoint?: string[]
  regionId?: string
}

/**
 * Parameters for creating a snapshot from an existing sandbox.
 *
 * @property {string} name - Name of the snapshot.
 * @property {string} [description] - Description of the snapshot.
 * @property {number} [cpu] - CPU cores allocated to the resulting sandbox.
 * @property {number} [gpu] - GPU units allocated to the resulting sandbox.
 * @property {number} [memory] - Memory allocated to the resulting sandbox in GiB.
 * @property {number} [disk] - Disk space allocated to the resulting sandbox in GiB.
 */
export interface CreateSnapshotFromSandboxParams {
  name: string
  description?: string
  cpu?: number
  gpu?: number
  memory?: number
  disk?: number
}

/**
 * Service for managing Daytona Snapshots. Can be used to list, get, create and delete Snapshots.
 *
 * @class
 */
export class SnapshotService {
  constructor(
    private clientConfig: Configuration,
    private snapshotsApi: SnapshotsApi,
    private objectStorageApi: ObjectStorageApi,
    private sandboxApi: SandboxApi,
    private defaultRegionId?: string,
  ) {}

  /**
   * List paginated list of Snapshots.
   *
   * @param {number} [page] - Page number for pagination (starting from 1)
   * @param {number} [limit] - Maximum number of items per page
   * @returns {Promise<PaginatedSnapshots>} Paginated list of Snapshots
   *
   * @example
   * const daytona = new Daytona();
   * const result = await daytona.snapshot.list(2, 10);
   * console.log(`Found ${result.total} snapshots`);
   * result.items.forEach(snapshot => console.log(`${snapshot.name} (${snapshot.imageName})`));
   */
  @WithInstrumentation()
  async list(page?: number, limit?: number): Promise<PaginatedSnapshots> {
    const response = await this.snapshotsApi.getAllSnapshots(undefined, page, limit)
    return {
      items: response.data.items.map((snapshot) => snapshot as Snapshot),
      total: response.data.total,
      page: response.data.page,
      totalPages: response.data.totalPages,
    }
  }

  /**
   * Gets a Snapshot by its name.
   *
   * @param {string} name - Name of the Snapshot to retrieve
   * @returns {Promise<Snapshot>} The requested Snapshot
   * @throws {Error} If the Snapshot does not exist or cannot be accessed
   *
   * @example
   * const daytona = new Daytona();
   * const snapshot = await daytona.snapshot.get("snapshot-name");
   * console.log(`Snapshot ${snapshot.name} is in state ${snapshot.state}`);
   */
  @WithInstrumentation()
  async get(name: string): Promise<Snapshot> {
    const response = await this.snapshotsApi.getSnapshot(name)
    return response.data as Snapshot
  }

  /**
   * Deletes a Snapshot.
   *
   * @param {Snapshot} snapshot - Snapshot to delete
   * @returns {Promise<void>}
   * @throws {Error} If the Snapshot does not exist or cannot be deleted
   *
   * @example
   * const daytona = new Daytona();
   * const snapshot = await daytona.snapshot.get("snapshot-name");
   * await daytona.snapshot.delete(snapshot);
   * console.log("Snapshot deleted successfully");
   */
  @WithInstrumentation()
  async delete(snapshot: Snapshot): Promise<void> {
    await this.snapshotsApi.removeSnapshot(snapshot.id)
  }

  /**
   * Creates and registers a new snapshot from the given Image definition.
   *
   * @param {CreateSnapshotParams} params - Parameters for snapshot creation.
   * @param {object} options - Options for the create operation.
   * @param {boolean} options.onLogs - This callback function handles snapshot creation logs.
   * @param {number} options.timeout - Default is no timeout. Timeout in seconds (0 means no timeout).
   * @returns {Promise<void>}
   *
   * @example
   * const image = Image.debianSlim('3.12').pipInstall('numpy');
   * await daytona.snapshot.create({ name: 'my-snapshot', image: image }, { onLogs: console.log });
   */
  @WithInstrumentation()
  public async create(
    params: CreateSnapshotParams,
    options: { onLogs?: (chunk: string) => void; timeout?: number } = {},
  ): Promise<Snapshot> {
    const createSnapshotReq: CreateSnapshot = {
      name: params.name,
    }

    if (typeof params.image === 'string') {
      createSnapshotReq.imageName = params.image
      createSnapshotReq.entrypoint = params.entrypoint
    } else {
      const contextHashes = await SnapshotService.processImageContext(this.objectStorageApi, params.image)
      createSnapshotReq.buildInfo = {
        contextHashes,
        dockerfileContent: params.entrypoint
          ? params.image.entrypoint(params.entrypoint).dockerfile
          : params.image.dockerfile,
      }
    }

    if (params.resources) {
      createSnapshotReq.cpu = params.resources.cpu
      createSnapshotReq.gpu = params.resources.gpu
      createSnapshotReq.memory = params.resources.memory
      createSnapshotReq.disk = params.resources.disk
    }

    createSnapshotReq.regionId = params.regionId || this.defaultRegionId

    let createdSnapshot = (
      await this.snapshotsApi.createSnapshot(createSnapshotReq, undefined, {
        timeout: (options.timeout || 0) * 1000,
      })
    ).data

    if (!createdSnapshot) {
      throw new DaytonaError("Failed to create snapshot. Didn't receive a snapshot from the server API.")
    }

    const terminalStates: SnapshotState[] = [SnapshotState.ACTIVE, SnapshotState.ERROR, SnapshotState.BUILD_FAILED]
    const snapshotRef = { createdSnapshot: createdSnapshot }
    let streamPromise: Promise<void> | undefined
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const startLogStreaming = async (onChunk: (chunk: string) => void = () => {}) => {
      if (!streamPromise) {
        const response = await this.snapshotsApi.getSnapshotBuildLogsUrl(createdSnapshot.id)

        const url = `${response.data.url}?follow=true`

        streamPromise = processStreamingResponse(
          () => fetch(url, { method: 'GET', headers: this.clientConfig.baseOptions.headers }),
          (chunk) => onChunk(chunk.trimEnd()),
          async () => terminalStates.includes(snapshotRef.createdSnapshot.state),
        )
      }
    }

    if (options.onLogs) {
      options.onLogs(`Creating snapshot ${createdSnapshot.name} (${createdSnapshot.state})`)

      if (
        createSnapshotReq.buildInfo &&
        createdSnapshot.state !== SnapshotState.PENDING &&
        !terminalStates.includes(createdSnapshot.state)
      ) {
        await startLogStreaming(options.onLogs)
      }
    }

    let previousState = createdSnapshot.state
    while (!terminalStates.includes(createdSnapshot.state)) {
      if (options.onLogs && previousState !== createdSnapshot.state) {
        if (createSnapshotReq.buildInfo && createdSnapshot.state !== SnapshotState.PENDING && !streamPromise) {
          await startLogStreaming(options.onLogs)
        }
        options.onLogs(`Creating snapshot ${createdSnapshot.name} (${createdSnapshot.state})`)
        previousState = createdSnapshot.state
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
      createdSnapshot = await this.get(createdSnapshot.name)
      snapshotRef.createdSnapshot = createdSnapshot
    }

    if (options.onLogs) {
      if (streamPromise) {
        await streamPromise
      }
      if (createdSnapshot.state === SnapshotState.ACTIVE) {
        options.onLogs(`Created snapshot ${createdSnapshot.name} (${createdSnapshot.state})`)
      }
    }

    if (createdSnapshot.state === SnapshotState.ERROR || createdSnapshot.state === SnapshotState.BUILD_FAILED) {
      const errMsg = `Failed to create snapshot. Name: ${createdSnapshot.name} Reason: ${createdSnapshot.errorReason}`
      throw new DaytonaError(errMsg)
    }

    return createdSnapshot as Snapshot
  }

  /**
   * Activates a snapshot.
   *
   * @param {Snapshot} snapshot - Snapshot to activate
   * @returns {Promise<Snapshot>} The activated Snapshot instance
   */
  @WithInstrumentation()
  async activate(snapshot: Snapshot): Promise<Snapshot> {
    return (await this.snapshotsApi.activateSnapshot(snapshot.id)).data as Snapshot
  }

  /**
   * Creates a snapshot from an existing sandbox. The sandbox can be running or stopped.
   * Polls until the snapshot reaches ACTIVE state or the timeout is exceeded.
   *
   * @param {Sandbox | string} sandbox - The Sandbox instance or sandbox ID to create a snapshot from
   * @param {CreateSnapshotFromSandboxParams} params - Parameters for snapshot creation
   * @param {object} [options] - Options for the create operation
   * @param {number} [options.timeout] - Timeout in seconds (default is 300)
   * @param {function} [options.onLogs] - Callback function to handle snapshot creation logs
   * @returns {Promise<Snapshot>} The created Snapshot in ACTIVE state
   * @throws {DaytonaError} If the snapshot creation fails or times out
   *
   * @example
   * const daytona = new Daytona();
   * const sandbox = await daytona.create();
   * const snapshot = await daytona.snapshot.createFromSandbox(sandbox, { name: 'my-snapshot' });
   * console.log(`Snapshot ${snapshot.name} created successfully`);
   *
   * @example
   * // Using sandbox ID string
   * const snapshot = await daytona.snapshot.createFromSandbox('sandbox-id', {
   *   name: 'my-snapshot',
   *   description: 'Snapshot with pre-installed dependencies',
   *   cpu: 2,
   *   memory: 4,
   * }, { timeout: 600 });
   */
  @WithInstrumentation()
  async createFromSandbox(
    sandbox: Sandbox | string,
    params: CreateSnapshotFromSandboxParams,
    options?: {
      timeout?: number
      onLogs?: (chunk: string) => void
    },
  ): Promise<Snapshot> {
    const sandboxId = typeof sandbox === 'string' ? sandbox : sandbox.id

    const response = await this.sandboxApi.createSnapshotFromSandbox(sandboxId, {
      name: params.name,
      description: params.description,
      cpu: params.cpu,
      gpu: params.gpu,
      memory: params.memory,
      disk: params.disk,
    })

    const createdSnapshot = response.data
    if (!createdSnapshot) {
      throw new DaytonaError("Failed to create snapshot from sandbox. Didn't receive a snapshot from the server API.")
    }

    const snapshotName = createdSnapshot.name
    const timeoutMs = (options?.timeout ?? 300) * 1000
    const startTime = Date.now()

    while (true) {
      if (Date.now() - startTime > timeoutMs) {
        throw new DaytonaError(`Snapshot creation timed out after ${options?.timeout ?? 300}s`)
      }

      const snapshot = await this.get(snapshotName)

      if (snapshot.state === SnapshotState.ACTIVE) {
        return snapshot
      }

      if (snapshot.state === SnapshotState.ERROR || snapshot.state === SnapshotState.BUILD_FAILED) {
        throw new DaytonaError(`Snapshot creation failed: ${snapshot.errorReason}`)
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  /**
   * Processes the image contexts by uploading them to object storage
   *
   * @private
   * @param {Image} image - The Image instance.
   * @returns {Promise<string[]>} The list of context hashes stored in object storage.
   */
  @WithInstrumentation()
  static async processImageContext(objectStorageApi: ObjectStorageApi, image: Image): Promise<string[]> {
    if (!image.contextList || !image.contextList.length) {
      return []
    }

    const ObjectStorageModule = await dynamicImport('ObjectStorage', '"processImageContext" is not supported: ')
    const pushAccessCreds = (await objectStorageApi.getPushAccess()).data
    const objectStorage = new ObjectStorageModule.ObjectStorage({
      endpointUrl: pushAccessCreds.storageUrl,
      accessKeyId: pushAccessCreds.accessKey,
      secretAccessKey: pushAccessCreds.secret,
      sessionToken: pushAccessCreds.sessionToken,
      bucketName: pushAccessCreds.bucket,
    })

    const contextHashes = []
    for (const context of image.contextList) {
      const contextHash = await objectStorage.upload(
        context.sourcePath,
        pushAccessCreds.organizationId,
        context.archivePath,
      )
      contextHashes.push(contextHash)
    }

    return contextHashes
  }
}
