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

exports.handler = async (event) => {
    try {
      if (!Array.isArray(event.fields) || event.fields.length === 0) {
        return createResponse(400, { message: 'Fields are required.' });
      }
  
      for (const field of event.fields) {
        const fieldName = field.fieldName;
        const fieldValues = field.fieldValues;
  
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
  

// sample data

// {
//     "fields": [
//       {
//         "fieldName": "states",
//         "fieldValues": {
//           "Alabama": "AL",
//           "Alaska": "AK",
//          "Arizona": "AZ",}
//       },
//       {
//         "fieldName": "combosku",
//         "fieldValues": {
//           "C": "100",
//           "S": "101",}
//       },
//       {
//         "fieldName": "featureToggle",
//         "fieldValues": true
//       }
//     ]
//   }
  