const fs = require('fs');

const extractType = (str) => {
    return (str.match(/^(<[a-z/]{1,}>)/))[1];
}

const extractValue = (str) => {
    return (str.match(/^<.{1,}>(.{1,})<\/.{1,}>$/))[1];
}

const formNode = (data, startIndex) => {
    let valueLine = data[startIndex];
    const childType = extractType(valueLine);
    let value;
    let temp;
    let endindex;
    switch (childType) {
        case '<dict>':
            value = {};
            do {
                key = extractValue(data[startIndex+1])
                temp = formNode(data, startIndex+2)
                value[key] = temp[0];
                endindex = temp[1] + 1;
                startIndex = temp[1];
            } while (data[endindex] != "</dict>")
            break;
        case '<array>':
            value = [];
            let newIndex = startIndex + 1;
            while (data[newIndex] != "</array>") {
                temp = formNode(data, newIndex);
                value.push(temp[0]);
                newIndex = temp[1];
                newIndex++;
            };
            endindex = newIndex;
            break;
        case '<true/>':
            value = true;
            endindex = startIndex;
            break;
        case '<false/>':
            value = false;
            endindex = startIndex;
            break;
        case '<integer>':
        case '<real>':
            value = extractValue(valueLine) - 0;
            endindex = startIndex;
            break;
        case '<date>':
        case '<data>':
        case '<string>':
            value = extractValue(valueLine);
            endindex = startIndex;
            break;
        default:
            value = undefined;
            endindex = startIndex;
            console.error("Cant proceed lement: " + childType);
            break;
    }
    return [value, endindex]
}

const xmlToJson = (data) => {
    let cleanedData = data.replace(/\t/g, "")
    cleanedData = cleanedData.split(/\n/g).filter(el => el).map(el => el.trim());
    let l = cleanedData.length;
    let result = {};
    let temp;
    for (let i = 0; i < l; i++) {
        if (cleanedData[i].startsWith("<key>")) {
            temp = formNode(cleanedData, i+1);
            result[extractValue(cleanedData[i])] = temp[0];
            i = temp[1];
        }
    }
    return result;
} 

const fileParser = (filename) => {
    return new Promise((resolve, reject) => {
        fs.readFile(`${filename}`, 'utf8', (err, data) => {
            if (err) return reject(err);
            resolve(xmlToJson(data));
          })
      })
}

module.exports = function(filepath) {
    return fileParser(filepath)
}