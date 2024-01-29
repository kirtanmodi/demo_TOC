const AWS = require('aws-sdk');
const configValues = require('./configValues');

AWS.config.update({ region: process.env.AWS_REGION || 'us-east-2' });

const docClient = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.CONFIG_VALUES_TABLE;

const checkIfValueExists = async (fieldName) => {
  const params = {
    TableName: tableName,
    Key: {
      value: fieldName,
    },
  };

  const result = await docClient.get(params).promise();
  return result.Item !== undefined;
};

const updateConfigValue = async (fieldName, fieldValues) => {
  const exists = await checkIfValueExists(fieldName);
  if (exists) {
    console.log(`Config value for ${fieldName} already exists. Skipping update.`);
    return;
  }

  const updateParams = {
    TableName: tableName,
    Item: {
      value: fieldName,
      data: JSON.stringify(fieldValues),
    },
  };

  await docClient.put(updateParams).promise();
  console.log(`Config values for ${fieldName} updated successfully.`);
};

module.exports.handler = async () => {
  try {
    const keys = Object.keys(configValues);
    for (const fieldName of keys) {
      await updateConfigValue(fieldName, configValues[fieldName]);
    }

    console.log('All config values updated successfully.');

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true,
      },
      body: JSON.stringify({ message: 'All config values updated successfully.' }),
    };

  } catch (error) {
    console.error('Error updating config values:', error);
    throw new Error('Failed to update config values in database');
  }
};
