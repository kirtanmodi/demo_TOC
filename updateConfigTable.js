const AWS = require('aws-sdk');
const configValues = require('./configValues');

AWS.config.update({ region: process.env.AWS_REGION || 'ap-south-1' });

const docClient = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.CONFIG_VALUES_TABLE;

const updateConfigValue = async (fieldName, fieldValues) => {
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
  console.log('tableName:', tableName);
  try {
    const keys = Object.keys(configValues);
    for (const fieldName of keys) {
      await updateConfigValue(fieldName, configValues[fieldName]);
    }
    
    console.log('All config values updated successfully.');
  } catch (error) {
    console.error('Error updating config values:', error);
    throw error;
  }
};
