const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.CONFIG_VALUES_TABLE;

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

const createResponse = (statusCode, body) => {
  return {
    statusCode: statusCode,
    body: JSON.stringify(body),
  };
};

exports.handler = async (event) => {
  try {
    const fieldName = event.fieldName;

    if (!fieldName) {
      return createResponse(400, { message: 'Field name is required.' });
    }

    const fieldValues = await fetchConfigValues(fieldName);

    if (fieldValues) {
      return createResponse(200, fieldValues);
    } else {
      return createResponse(404, { message: 'Field name not found in config values.' });
    }
  } catch (error) {
    console.error('Error fetching config values:', error);
    return createResponse(500, { message: 'Internal server error.' });
  }
};
