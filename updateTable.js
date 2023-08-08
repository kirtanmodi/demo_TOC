const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.CONFIG_VALUES_TABLE;

const updateConfigValues = async (fieldName, fieldValues) => {
  const updateParams = {
    TableName: tableName,
    Item: {
      value: fieldName,
      data: JSON.stringify(fieldValues),
    },
  };

  try {
    await docClient.put(updateParams).promise();
  } catch (error) {
    console.error('Error updating config values:', error);
    throw new Error('Failed to update config values in database');
  }
};

const createResponse = (statusCode, body) => {
  return {
    statusCode: statusCode,
    body: JSON.stringify(body),
  };
};

const fetchConfigValues = async (fieldName) => {
    const queryParams = {
      TableName: tableName,
      Key: { value: fieldName },
    };

    try {
      const data = await docClient.get(queryParams).promise();
      return data.Item ? data.Item.data : null;
    } catch (error) {
      console.error('Error fetching config values:', error);
      throw new Error('Failed to fetch config values from database');
    }
  };


/**
 * AWS Lambda function handler that updates the config values based on the provided field name.
 * @example
*{
*     "fields": [
*       {
*         "fieldName": "states",
*         "fieldValues": {
*           "Alabama": "AL",
*           "Alaska": "AK",
*          "Arizona": "AZ",}
*       },
*       {
*         "fieldName": "combosku",
*         "fieldValues": {
*           "C": "100",
*           "S": "101",}
*       },
*     ]
*   }
* */
exports.handler = async (event) => {
  const fields = JSON.parse(event.body).fields;
    try {
      if (!fields || fields.length === 0) {
        return createResponse(400, { message: 'Fields are required.' });
      }

      for (const field of fields) {
        const fieldName = field.fieldName;
        const fieldValues = field.fieldValues;

        const existingValue = await fetchConfigValues(fieldName);
        if (existingValue === null) {
          console.log(`Field name ${fieldName} not found in config values. Skipping update.`);

          return createResponse(404, { message: `Field name ${fieldName} not found in config values. Skipping update.` });
        }

        if (!fieldName || fieldValues === undefined) {
          return createResponse(400, { message: 'Field name and values are required for each field.' });
        }

        await updateConfigValues(fieldName, fieldValues);
      }

      return createResponse(200, { message: 'Config values updated successfully.' });
    } catch (error) {
      console.error('Error updating config values:', error);
      return createResponse(500, { message: 'Internal server error.' });
    }
  };

