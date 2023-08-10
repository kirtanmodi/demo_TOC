const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.CONFIG_VALUES_TABLE;

const fetchAllConfigValues = async () => {
  const scanParams = {
    TableName: tableName,
  };

  try {
    const data = await docClient.scan(scanParams).promise();
    return data.Items ? data.Items : [];
  } catch (error) {
    console.error('Error fetching config values:', error);
    throw new Error('Failed to fetch config values from database');
  }
};

const createResponse = (statusCode, body) => {
  return {
    statusCode: statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*", // You can specify a specific origin
      "Access-Control-Allow-Credentials": true,
    },
    body: JSON.stringify(body),
  };
};

exports.handler = async () => {
  try {
    const allConfigValues = await fetchAllConfigValues();

    if (allConfigValues.length > 0) {
      return createResponse(200, allConfigValues);
    } else {
      return createResponse(404, { message: 'No config values found.' });
    }
  } catch (error) {
    console.error('Error fetching config values:', error);
    return createResponse(500, { message: 'Internal server error.' });
  }
};
