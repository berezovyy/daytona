/*
 * Copyright Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { MigrationInterface, QueryRunner } from 'typeorm'

export class Migration1773476728938 implements MigrationInterface {
  name = 'Migration1773476728938'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "snapshot" ADD "sourceSandboxId" uuid`)
    await queryRunner.query(`CREATE INDEX "snapshot_source_sandbox_idx" ON "snapshot" ("sourceSandboxId") `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."snapshot_source_sandbox_idx"`)
    await queryRunner.query(`ALTER TABLE "snapshot" DROP COLUMN "sourceSandboxId"`)
  }
}
