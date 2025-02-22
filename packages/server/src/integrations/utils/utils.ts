import {
  SqlQuery,
  Table,
  Datasource,
  FieldType,
  TableSourceType,
} from "@budibase/types"
import { DocumentType, SEPARATOR } from "../../db/utils"
import { InvalidColumns, DEFAULT_BB_DATASOURCE_ID } from "../../constants"
import { SWITCHABLE_TYPES, helpers } from "@budibase/shared-core"
import env from "../../environment"
import { Knex } from "knex"

const DOUBLE_SEPARATOR = `${SEPARATOR}${SEPARATOR}`
const ROW_ID_REGEX = /^\[.*]$/g
const ENCODED_SPACE = encodeURIComponent(" ")

const SQL_NUMBER_TYPE_MAP = {
  integer: FieldType.NUMBER,
  int: FieldType.NUMBER,
  decimal: FieldType.NUMBER,
  smallint: FieldType.NUMBER,
  real: FieldType.NUMBER,
  float: FieldType.NUMBER,
  numeric: FieldType.NUMBER,
  mediumint: FieldType.NUMBER,
  dec: FieldType.NUMBER,
  double: FieldType.NUMBER,
  fixed: FieldType.NUMBER,
  "double precision": FieldType.NUMBER,
  number: FieldType.NUMBER,
  binary_float: FieldType.NUMBER,
  binary_double: FieldType.NUMBER,
  money: FieldType.NUMBER,
  smallmoney: FieldType.NUMBER,
}

const SQL_DATE_TYPE_MAP = {
  timestamp: FieldType.DATETIME,
  time: FieldType.DATETIME,
  datetime: FieldType.DATETIME,
  smalldatetime: FieldType.DATETIME,
  date: FieldType.DATETIME,
}

const SQL_DATE_ONLY_TYPES = ["date"]
const SQL_TIME_ONLY_TYPES = ["time"]

const SQL_STRING_TYPE_MAP = {
  varchar: FieldType.STRING,
  char: FieldType.STRING,
  nchar: FieldType.STRING,
  nvarchar: FieldType.STRING,
  ntext: FieldType.STRING,
  enum: FieldType.STRING,
  blob: FieldType.STRING,
  long: FieldType.STRING,
  text: FieldType.STRING,
}

const SQL_BOOLEAN_TYPE_MAP = {
  boolean: FieldType.BOOLEAN,
  bit: FieldType.BOOLEAN,
  tinyint: FieldType.BOOLEAN,
}

const SQL_OPTIONS_TYPE_MAP = {
  "user-defined": FieldType.OPTIONS,
}

const SQL_MISC_TYPE_MAP = {
  json: FieldType.JSON,
  bigint: FieldType.BIGINT,
}

const SQL_TYPE_MAP = {
  ...SQL_NUMBER_TYPE_MAP,
  ...SQL_DATE_TYPE_MAP,
  ...SQL_STRING_TYPE_MAP,
  ...SQL_BOOLEAN_TYPE_MAP,
  ...SQL_MISC_TYPE_MAP,
  ...SQL_OPTIONS_TYPE_MAP,
}

export enum SqlClient {
  MS_SQL = "mssql",
  POSTGRES = "pg",
  MY_SQL = "mysql2",
  ORACLE = "oracledb",
  SQL_LITE = "sqlite3",
}

const isCloud = env.isProd() && !env.SELF_HOSTED
const isSelfHost = env.isProd() && env.SELF_HOSTED
export const HOST_ADDRESS = isSelfHost
  ? "host.docker.internal"
  : isCloud
  ? ""
  : "localhost"

export function isExternalTableID(tableId: string) {
  return tableId.includes(DocumentType.DATASOURCE)
}

export function isInternalTableID(tableId: string) {
  return !isExternalTableID(tableId)
}

export function getNativeSql(
  query: Knex.SchemaBuilder | Knex.QueryBuilder
): SqlQuery | SqlQuery[] {
  let sql = query.toSQL()
  if (Array.isArray(sql)) {
    return sql as SqlQuery[]
  }
  let native: Knex.SqlNative | undefined
  if (sql.toNative) {
    native = sql.toNative()
  }
  return {
    sql: native?.sql || sql.sql,
    bindings: native?.bindings || sql.bindings,
  } as SqlQuery
}

export function isExternalTable(table: Table) {
  if (
    table?.sourceId &&
    table.sourceId.includes(DocumentType.DATASOURCE + SEPARATOR) &&
    table?.sourceId !== DEFAULT_BB_DATASOURCE_ID
  ) {
    return true
  } else if (table?.sourceType === TableSourceType.EXTERNAL) {
    return true
  } else if (table?._id && isExternalTableID(table._id)) {
    return true
  }
  return false
}

export function buildExternalTableId(datasourceId: string, tableName: string) {
  // encode spaces
  if (tableName.includes(" ")) {
    tableName = encodeURIComponent(tableName)
  }
  return `${datasourceId}${DOUBLE_SEPARATOR}${tableName}`
}

export function breakExternalTableId(tableId: string | undefined) {
  if (!tableId) {
    return {}
  }
  const parts = tableId.split(DOUBLE_SEPARATOR)
  let datasourceId = parts.shift()
  // if they need joined
  let tableName = parts.join(DOUBLE_SEPARATOR)
  // if contains encoded spaces, decode it
  if (tableName.includes(ENCODED_SPACE)) {
    tableName = decodeURIComponent(tableName)
  }
  return { datasourceId, tableName }
}

export function generateRowIdField(keyProps: any[] = []) {
  if (!Array.isArray(keyProps)) {
    keyProps = [keyProps]
  }
  // this conserves order and types
  // we have to swap the double quotes to single quotes for use in HBS statements
  // when using the literal helper the double quotes can break things
  return encodeURIComponent(JSON.stringify(keyProps).replace(/"/g, "'"))
}

export function isRowId(field: any) {
  return (
    Array.isArray(field) ||
    (typeof field === "string" && field.match(ROW_ID_REGEX) != null)
  )
}

export function convertRowId(field: any) {
  if (Array.isArray(field)) {
    return field[0]
  }
  if (typeof field === "string" && field.match(ROW_ID_REGEX) != null) {
    return field.substring(1, field.length - 1)
  }
  return field
}

// should always return an array
export function breakRowIdField(_id: string | { _id: string }): any[] {
  if (!_id) {
    return []
  }
  // have to replace on the way back as we swapped out the double quotes
  // when encoding, but JSON can't handle the single quotes
  const id = typeof _id === "string" ? _id : _id._id
  const decoded: string = decodeURIComponent(id).replace(/'/g, '"')
  try {
    const parsed = JSON.parse(decoded)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch (err) {
    // wasn't json - likely was handlebars for a many to many
    return [_id]
  }
}

export function generateColumnDefinition(config: {
  externalType: string
  autocolumn: boolean
  name: string
  presence: boolean
  options?: string[]
}) {
  let { externalType, autocolumn, name, presence, options } = config
  let foundType = FieldType.STRING
  const lowerCaseType = externalType.toLowerCase()
  let matchingTypes = []
  for (let [external, internal] of Object.entries(SQL_TYPE_MAP)) {
    if (lowerCaseType.includes(external)) {
      matchingTypes.push({ external, internal })
    }
  }
  // Set the foundType based the longest match
  if (matchingTypes.length > 0) {
    foundType = matchingTypes.reduce((acc, val) => {
      return acc.external.length >= val.external.length ? acc : val
    }).internal
  }

  const constraints: {
    presence: boolean
    inclusion?: string[]
  } = {
    presence,
  }
  if (foundType === FieldType.OPTIONS) {
    constraints.inclusion = options
  }

  const schema: any = {
    type: foundType,
    externalType,
    autocolumn,
    name,
    constraints,
  }
  if (foundType === FieldType.DATETIME) {
    schema.dateOnly = SQL_DATE_ONLY_TYPES.includes(lowerCaseType)
    schema.timeOnly = SQL_TIME_ONLY_TYPES.includes(lowerCaseType)
  }
  return schema
}

export function getSqlQuery(query: SqlQuery | string): SqlQuery {
  if (typeof query === "string") {
    return { sql: query }
  } else {
    return query
  }
}

export function isSQL(datasource: Datasource) {
  return helpers.isSQL(datasource)
}

export function isIsoDateString(str: string) {
  const trimmedValue = str.trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(trimmedValue)) {
    return false
  }
  let d = new Date(trimmedValue)
  return d.toISOString() === trimmedValue
}

/**
 * This function will determine whether a column is a relationship and whether it
 * is currently valid. The reason for the validity check is that tables can be deleted
 * outside of Budibase control and if this is the case it will break Budibase relationships.
 * The tableIds is a list passed down from the main finalise tables function, which is
 * based on the tables that have just been fetched. This will only really be used on subsequent
 * fetches to the first one - if the user is periodically refreshing Budibase knowledge of tables.
 * @param column The column to check, to see if it is a valid relationship.
 * @param tableIds The IDs of the tables which currently exist.
 */
function shouldCopyRelationship(
  column: { type: FieldType.LINK; tableId?: string },
  tableIds: string[]
) {
  return (
    column.type === FieldType.LINK &&
    column.tableId &&
    tableIds.includes(column.tableId)
  )
}

/**
 * Similar function to the shouldCopyRelationship function, but instead this looks for options and boolean
 * types. It is possible to switch a string -> options and a number -> boolean (and vice versus) need to make
 * sure that these get copied over when tables are fetched. Also checks whether they are still valid, if a
 * column has changed type in the external database then copying it over may not be possible.
 * @param column The column to check for options or boolean type.
 * @param fetchedColumn The fetched column to check for the type in the external database.
 */
function shouldCopySpecialColumn(
  column: { type: FieldType },
  fetchedColumn: { type: FieldType } | undefined
) {
  const isFormula = column.type === FieldType.FORMULA
  // column has been deleted, remove - formulas will never exist, always copy
  if (!isFormula && column && !fetchedColumn) {
    return false
  }
  const fetchedIsNumber =
    !fetchedColumn || fetchedColumn.type === FieldType.NUMBER
  return fetchedIsNumber && column.type === FieldType.BOOLEAN
}

/**
 * Looks for columns which need to be copied over into the new table definitions, like relationships,
 * options types and views.
 * @param tableName The name of the table which is being checked.
 * @param table The specific table which is being checked.
 * @param entities All the tables that existed before - the old table definitions.
 * @param tableIds The IDs of the tables which exist now, to check if anything has been removed.
 */
function copyExistingPropsOver(
  tableName: string,
  table: Table,
  entities: Record<string, Table>,
  tableIds: string[]
): Table {
  if (entities && entities[tableName]) {
    if (entities[tableName]?.primaryDisplay) {
      table.primaryDisplay = entities[tableName].primaryDisplay
    }
    if (entities[tableName]?.created) {
      table.created = entities[tableName]?.created
    }

    table.views = entities[tableName].views

    const existingTableSchema = entities[tableName].schema
    for (let key in existingTableSchema) {
      if (!Object.prototype.hasOwnProperty.call(existingTableSchema, key)) {
        continue
      }
      const column = existingTableSchema[key]

      const existingColumnType = column?.type
      const updatedColumnType = table.schema[key]?.type

      // If the db column type changed to a non-compatible one, we want to re-fetch it
      if (
        updatedColumnType !== existingColumnType &&
        !SWITCHABLE_TYPES[updatedColumnType]?.includes(existingColumnType)
      ) {
        continue
      }

      if (
        column.type === FieldType.LINK &&
        !shouldCopyRelationship(column, tableIds)
      ) {
        continue
      }

      const specialTypes = [
        FieldType.OPTIONS,
        FieldType.LONGFORM,
        FieldType.ARRAY,
        FieldType.FORMULA,
        FieldType.BB_REFERENCE,
      ]
      if (
        specialTypes.includes(column.type) &&
        !shouldCopySpecialColumn(column, table.schema[key])
      ) {
        continue
      }

      table.schema[key] = {
        ...existingTableSchema[key],
        externalType:
          existingTableSchema[key].externalType ||
          table.schema[key].externalType,
      }
    }
  }
  return table
}

/**
 * Look through the final table definitions to see if anything needs to be
 * copied over from the old.
 * @param tables The list of tables that have been retrieved from the external database.
 * @param entities The old list of tables, if there was any to look for definitions in.
 */
export function finaliseExternalTables(
  tables: Record<string, Table>,
  entities: Record<string, Table>
): Record<string, Table> {
  let finalTables: Record<string, Table> = {}
  const tableIds = Object.values(tables).map(table => table._id!)
  for (let [name, table] of Object.entries(tables)) {
    finalTables[name] = copyExistingPropsOver(name, table, entities, tableIds)
  }
  // sort the tables by name, this is for the UI to display them in alphabetical order
  return Object.entries(finalTables)
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce((r, [k, v]) => ({ ...r, [k]: v }), {})
}

export function checkExternalTables(
  tables: Record<string, Table>
): Record<string, string> {
  const invalidColumns = Object.values(InvalidColumns) as string[]
  const errors: Record<string, string> = {}
  for (let [name, table] of Object.entries(tables)) {
    if (!table.primary || table.primary.length === 0) {
      errors[name] = "Table must have a primary key."
    }

    const columnNames = Object.keys(table.schema)
    if (columnNames.find(f => invalidColumns.includes(f))) {
      errors[name] = "Table contains invalid columns."
    }
  }
  return errors
}

/**
 * Checks if the provided input is an object, but specifically not a date type object.
 * Used during coercion of types and relationship handling, dates are considered valid
 * and can be used as a display field, but objects and arrays cannot.
 * @param testValue an unknown type which this function will attempt to extract
 * a valid primary display string from.
 */
export function getPrimaryDisplay(testValue: unknown): string | undefined {
  if (testValue instanceof Date) {
    return testValue.toISOString()
  }
  if (
    Array.isArray(testValue) &&
    testValue[0] &&
    typeof testValue[0] !== "object"
  ) {
    return testValue.join(", ")
  }
  if (typeof testValue === "object") {
    return undefined
  }
  return testValue as string
}

export function isValidFilter(value: any) {
  return value != null && value !== ""
}
